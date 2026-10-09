import { useCallback, useEffect, useRef, useState } from "react";
import { PlayerControls } from "./components/PlayerControls";
import { PopoverView } from "./components/PopoverView";
import { TrackList, type TrackListHandle } from "./components/TrackList";
import { UrlInput, type UrlInputHandle } from "./components/UrlInput";
import { VolumeControl } from "./components/VolumeControl";
import { useMediaSession } from "./hooks/useMediaSession";
import { usePlayer } from "./hooks/usePlayer";
import { useRepeatMode } from "./hooks/useRepeatMode";
import { useTracks } from "./hooks/useTracks";
import { useTransport } from "./hooks/useTransport";
import { useVolume } from "./hooks/useVolume";
import { addTrack } from "./lib/addTrack";
import { toUserMessage } from "./lib/errors";
import { wrapTab } from "./lib/focus";
import { strings } from "./lib/strings";
import { resolveStream } from "./lib/resolver";
import {
  hidePopover,
  onQuitRequested,
  onTrayAction,
  quitApp,
  setTrayMenu,
  setTrayState,
  showPopover,
  type ResolvedAudio,
  type Track,
} from "./lib/tauri";
import { trackToStart, trayMenu, type TrayAction } from "./lib/trayMenu";

function App() {
  const { tracks, loaded, error: tracksError, lastDeleted, save, savePosition, remove, undoRemove } = useTracks();

  // Playing a link saves it; a track that was already saved resumes from its last position.
  const handleResolved = useCallback(
    async (resolved: ResolvedAudio) => {
      const track = await save(resolved);
      return track?.position ?? 0;
    },
    [save],
  );

  // The player reports playback events to the transport, which is built from the player.
  const transportRef = useRef<ReturnType<typeof useTransport> | null>(null);

  const {
    audioRef,
    state,
    load,
    playResolved,
    getTrackId,
    play,
    pause,
    toggle,
    seek,
    restart,
    retry,
    savePosition: flushPosition,
    debug,
  } = usePlayer({
    onResolved: handleResolved,
    onPosition: savePosition,
    onPlaying: () => transportRef.current?.handlePlaying(),
    onEnded: () => transportRef.current?.handleEnded(),
  });

  const { mode: repeat, cycle: cycleRepeat } = useRepeatMode();
  const { volume, muted, setVolume, toggleMute } = useVolume(audioRef);
  const transport = useTransport({
    audioRef,
    tracks,
    trackId: state.trackId,
    getTrackId,
    repeat,
    load,
    playResolved,
    seek,
    restart,
  });
  transportRef.current = transport;
  // The system keys follow the buttons, and only exist while there is another track to go to.
  const hasOtherTracks = tracks.length > 1;

  // The menu bar icon follows playback, so its state can be read with the popover closed.
  const isPlaying = state.status === "playing";
  useEffect(() => {
    void setTrayState(isPlaying).catch(() => {});
  }, [isPlaying]);

  // The menu behind a right click on the icon offers the same play/pause and next.
  const menu = trayMenu({
    status: state.status,
    recovering: state.recovering,
    title: state.title,
    libraryIsEmpty: tracks.length === 0,
    canNext: hasOtherTracks && transport.canNext,
  });
  useEffect(() => {
    void setTrayMenu({ title: menu.title, playing: menu.playing, canToggle: menu.canToggle, canNext: menu.canNext }).catch(
      () => {},
    );
  }, [menu.title, menu.playing, menu.canToggle, menu.canNext]);

  // An action chosen there happens with the popover closed, so if it fails the
  // popover opens to say why.
  const actedFromMenuRef = useRef(false);
  const handleTrayAction = (action: TrayAction) => {
    actedFromMenuRef.current = true;
    if (action === "next") {
      transport.next();
    } else if (state.status === "playing" || state.status === "paused") {
      toggle();
    } else if (state.status === "error" && state.retryable) {
      retry();
    } else {
      const track = trackToStart(tracks, state.trackId);
      if (track) void load(track.url, { track });
    }
  };
  const handleTrayActionRef = useRef(handleTrayAction);
  handleTrayActionRef.current = handleTrayAction;
  useEffect(() => onTrayAction((action) => handleTrayActionRef.current(action)), []);
  useEffect(() => {
    if (!actedFromMenuRef.current || state.status === "loading" || state.recovering) return;
    actedFromMenuRef.current = false;
    if (state.status === "error") void showPopover().catch(() => {});
  }, [state.status, state.recovering]);

  useMediaSession({
    audioRef,
    status: state.status,
    recovering: state.recovering,
    title: state.title,
    duration: state.duration,
    play,
    pause,
    seek,
    next: hasOtherTracks && transport.canNext ? transport.next : null,
    previous: hasOtherTracks && transport.canPrevious ? transport.previous : null,
  });

  useEffect(
    () =>
      onQuitRequested(() => {
        void flushPosition().finally(quitApp);
      }),
    [flushPosition],
  );

  useEffect(() => {
    const isTextField = (target: EventTarget | null) =>
      target instanceof HTMLInputElement && target.type !== "range";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void hidePopover();
      } else if (event.key === "Tab") {
        if (wrapTab(document.body, event.shiftKey)) event.preventDefault();
      } else if (event.key === " " && !isTextField(event.target)) {
        // Space is play/pause everywhere but the URL field, focused buttons included.
        event.preventDefault();
        if (!event.repeat) toggle();
      }
    };
    // Buttons click on Space keyup; swallow it so Space only ever means play/pause.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " && !isTextField(event.target)) event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [toggle]);

  const urlInputRef = useRef<UrlInputHandle>(null);
  const trackListRef = useRef<TrackListHandle>(null);
  const focusUrlInput = useCallback(() => urlInputRef.current?.focus(), []);
  const focusTrackList = useCallback(() => void trackListRef.current?.focusFirst(), []);

  // Outcome of the last "Add", shown under the field until the text changes.
  const [addNotice, setAddNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const clearAddNotice = useCallback(() => setAddNotice(null), []);

  // Adding only saves the track: it never touches the player.
  const handleAdd = useCallback(
    async (url: string) => {
      setAddNotice(null);
      const result = await addTrack(url, tracks, { resolve: resolveStream, save });
      switch (result.kind) {
        case "added":
          trackListRef.current?.revealRow(result.track.id);
          urlInputRef.current?.focus();
          return true;
        case "duplicate":
          setAddNotice({ kind: "info", text: strings.library.alreadyAdded });
          trackListRef.current?.focusRow(result.track.id);
          return true;
        case "error":
          setAddNotice({ kind: "error", text: toUserMessage(result.error, strings.errors.resolveFailed) });
          return false;
      }
    },
    [tracks, save],
  );

  // The track already loaded just toggles; anything else starts loading.
  const isActive = state.status === "playing" || state.status === "paused";
  const playTrack = useCallback(
    (track: Track) => {
      if (isActive && track.id === state.trackId) {
        toggle();
      } else {
        void load(track.url, { track });
      }
    },
    [isActive, state.trackId, toggle, load],
  );

  // What playback is waiting on, in words, for assistive technology.
  const statusLabel = state.recovering
    ? strings.status.recovering
    : state.status === "loading"
      ? strings.status.loading
      : null;

  return (
    <>
      <PopoverView
        urlInput={
          <UrlInput ref={urlInputRef} onAdd={handleAdd} onEdit={clearAddNotice} onArrowDown={focusTrackList} />
        }
        addNotice={addNotice}
        list={
          loaded && (
            <TrackList
              ref={trackListRef}
              tracks={tracks}
              currentId={state.trackId}
              playing={state.status === "playing"}
              onPlay={playTrack}
              onDelete={remove}
              onExitUp={focusUrlInput}
            />
          )
        }
        libraryError={tracksError}
        onUndo={lastDeleted ? undoRemove : null}
        title={state.title}
        statusLabel={statusLabel}
        error={state.error}
        onRetry={state.retryable ? retry : null}
        controls={
          <PlayerControls
            status={state.status}
            recovering={state.recovering}
            currentTime={state.currentTime}
            duration={state.duration}
            onToggle={toggle}
            onSeek={seek}
            onPrevious={transport.previous}
            onNext={transport.next}
            canPrevious={transport.canPrevious}
            canNext={transport.canNext}
            repeat={repeat}
            onCycleRepeat={cycleRepeat}
          >
            <VolumeControl volume={volume} muted={muted} onVolumeChange={setVolume} onToggleMute={toggleMute} />
          </PlayerControls>
        }
        devTools={
          debug &&
          strings.debug && (
            <p className="notice flex gap-3">
              <button type="button" tabIndex={-1} onClick={debug.invalidate} className="text-button">
                {strings.debug.invalidate}
              </button>
              <button type="button" tabIndex={-1} onClick={debug.expire} className="text-button">
                {strings.debug.expire}
              </button>
            </p>
          )
        }
      />
      <audio ref={audioRef} preload="auto" />
    </>
  );
}

export default App;
