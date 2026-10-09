// Design preview, for development only. It draws the popover in every state
// with sample data and never touches Tauri or the network, so it can be opened
// in a plain browser at /preview.html.
import { useEffect, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import ReactDOM from "react-dom/client";
import { PauseIcon, PlayIcon, PlayPauseIcon, NextIcon, RepeatAllIcon, SpinnerIcon, VolumeHighIcon } from "../components/icons";
import { PlayerControls } from "../components/PlayerControls";
import { PopoverView } from "../components/PopoverView";
import { TrackList } from "../components/TrackList";
import { Slider } from "../components/Slider";
import { UrlInput } from "../components/UrlInput";
import { VolumeControl } from "../components/VolumeControl";
import type { PlayerStatus } from "../hooks/usePlayer";
import { formatTime } from "../lib/format";
import { strings } from "../lib/strings";
import type { Track } from "../lib/tauri";
import "../index.css";
import "./preview.css";

const noop = () => {};

const track = (n: number, title: string, minutes: number): Track => ({
  id: `t${n}`,
  url: `https://www.youtube.com/watch?v=t${n}`,
  title,
  duration: minutes * 60,
  position: 0,
  addedAt: "2026-10-08T10:00:00Z",
  lastPlayedAt: "2026-10-08T10:00:00Z",
});

const LIBRARY: Track[] = [
  track(1, "Aphex Twin – Printworks, London 14/09/19", 127.5),
  track(2, "Boards of Canada - The Half Awake Mix", 54.5),
  track(3, "Aphex Twin Live at Field Day 2017 (full set, soundboard recording, remastered audio)", 120.7),
  track(4, "Burial – Untrue (Full Album)", 50.4),
  track(5, "Autechre - Live at Krakow 2016, complete two hour performance in the dark", 118),
  track(6, "Brian Eno – Music for Airports", 48.5),
  track(7, "Selected Ambient Works 85-92", 74.8),
  track(8, "Four Tet Boiler Room London DJ Set", 61.2),
  track(9, "Short interlude", 3.2),
  track(10, "Global Communication – 76:14", 76.2),
  track(11, "Rain on a tin roof for sleeping, studying and deep focus (10 hours, no ads)", 600),
  track(12, "Biosphere - Substrata", 62.1),
];

interface FrameProps {
  name: string;
  library?: Track[];
  currentId?: string | null;
  status?: PlayerStatus;
  recovering?: boolean;
  time?: number;
  title?: string | null;
  statusLabel?: string | null;
  error?: string | null;
  retry?: boolean;
  addNotice?: { kind: "info" | "error"; text: string } | null;
  undo?: boolean;
  muted?: boolean;
  volume?: number;
  volumeOpen?: boolean;
  force?: Record<string, string>;
}

function Frame(props: FrameProps) {
  const { name, library = LIBRARY, currentId = "t1", status = "playing", recovering = false, time = 5025 } = props;
  const current = library.find((track) => track.id === currentId) ?? null;
  const title = props.title === undefined ? (current?.title ?? null) : props.title;

  return (
    <figure className="preview-frame">
      <figcaption>{name}</figcaption>
      <div className="preview-window">
        <PopoverView
          urlInput={<UrlInput onAdd={() => Promise.resolve(false)} onEdit={noop} onArrowDown={noop} />}
          addNotice={props.addNotice ?? null}
          list={
            <TrackList
              tracks={library}
              currentId={currentId}
              playing={status === "playing"}
              onPlay={noop}
              onDelete={noop}
              onExitUp={noop}
              force={props.force}
            />
          }
          libraryError={null}
          onUndo={props.undo ? noop : null}
          title={title}
          statusLabel={props.statusLabel ?? null}
          error={props.error ?? null}
          onRetry={props.retry ? noop : null}
          controls={
            <PlayerControls
              status={status}
              recovering={recovering}
              currentTime={time}
              duration={current && (status === "playing" || status === "paused") ? current.duration : 0}
              onToggle={noop}
              onSeek={noop}
              onPrevious={noop}
              onNext={noop}
              canPrevious={currentId !== null}
              canNext={currentId !== null && library.length > 1}
              repeat="all"
              onCycleRepeat={noop}
            >
              <VolumeControl
                volume={props.volume ?? 80}
                muted={props.muted ?? false}
                onVolumeChange={noop}
                onToggleMute={noop}
                force={props.volumeOpen ? "open" : undefined}
              />
            </PlayerControls>
          }
        />
      </div>
    </figure>
  );
}

function Swatch({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="preview-swatch">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function StateSheet() {
  const states: [string, string | undefined][] = [
    ["rest", undefined],
    ["hover", "hover"],
    ["focus", "focus"],
    ["pressed", "active"],
  ];
  const sliderProps = { value: 5025, max: 7650, formatTip: formatTime, onCommit: noop, inputProps: { "aria-label": "Progress", readOnly: true } };

  return (
    <section className="preview-sheet">
      <h2>States</h2>

      <h3>Library row</h3>
      <div className="preview-window preview-window--auto">
        <TrackList
          tracks={LIBRARY.slice(0, 6)}
          currentId="t5"
          playing
          onPlay={noop}
          onDelete={noop}
          onExitUp={noop}
          force={{ t2: "hover", t3: "focus", t4: "active" }}
        />
      </div>
      <p className="preview-note">rest · hover · focus · pressed · current, playing · rest</p>
      <div className="preview-window preview-window--auto">
        <TrackList tracks={LIBRARY.slice(0, 1)} currentId="t1" playing={false} onPlay={noop} onDelete={noop} onExitUp={noop} />
      </div>
      <p className="preview-note">current, paused</p>

      <h3>Player buttons</h3>
      <div className="preview-row">
        {states.map(([label, force]) => (
          <Swatch key={label} label={label}>
            <button type="button" className="icon-button" data-force={force}>
              <NextIcon />
            </button>
            <button type="button" className="icon-button play-button" data-force={force}>
              <PauseIcon />
            </button>
            <button type="button" className="icon-button" data-force={force}>
              <RepeatAllIcon />
            </button>
          </Swatch>
        ))}
        <Swatch label="disabled">
          <button type="button" className="icon-button" disabled>
            <NextIcon />
          </button>
          <button type="button" className="icon-button play-button" disabled>
            <PlayIcon />
          </button>
          <button type="button" className="icon-button" disabled>
            <VolumeHighIcon />
          </button>
        </Swatch>
      </div>

      <h3>Field and Add</h3>
      <div className="preview-row">
        {states.map(([label, force]) => (
          <Swatch key={label} label={label}>
            <input className="field" style={{ width: 150 }} placeholder={strings.urlInput.placeholder} data-force={label === "focus" ? force : undefined} readOnly />
            <button type="button" className="button" data-force={force}>
              {strings.urlInput.submit}
            </button>
          </Swatch>
        ))}
        <Swatch label="disabled / adding">
          <input className="field" style={{ width: 150 }} defaultValue="https://youtu.be/0D5ArpBlCe4" readOnly />
          <button type="button" className="button" disabled aria-busy="true" aria-label={strings.urlInput.adding}>
            <span className="busy-swap" data-busy="true">
              <span>{strings.urlInput.submit}</span>
              <SpinnerIcon />
            </span>
          </button>
        </Swatch>
      </div>

      <h3>Progress bar</h3>
      <div className="preview-col">
        <Swatch label="rest">
          <div style={{ width: 296 }}>
            <Slider {...sliderProps} />
          </div>
        </Swatch>
        <Swatch label="hover">
          <div style={{ width: 296 }}>
            <Slider {...sliderProps} force="hover" />
          </div>
        </Swatch>
        <Swatch label="focus">
          <div style={{ width: 296 }}>
            <Slider {...sliderProps} force="focus" />
          </div>
        </Swatch>
        <Swatch label="reconnecting">
          <div style={{ width: 296 }}>
            <Slider {...sliderProps} state="recovering" />
          </div>
        </Swatch>
        <Swatch label="loading">
          <div style={{ width: 296 }}>
            <Slider {...sliderProps} value={0} state="loading" />
          </div>
        </Swatch>
        <Swatch label="nothing loaded">
          <div style={{ width: 296 }}>
            <Slider {...sliderProps} value={0} max={0} disabled />
          </div>
        </Swatch>
      </div>

      <h3>Volume</h3>
      <div className="preview-row">
        <Swatch label="high, open">
          <div style={{ paddingTop: 112 }}>
            <VolumeControl volume={80} muted={false} onVolumeChange={noop} onToggleMute={noop} force="open" />
          </div>
        </Swatch>
        <Swatch label="low, open">
          <div style={{ paddingTop: 112 }}>
            <VolumeControl volume={30} muted={false} onVolumeChange={noop} onToggleMute={noop} force="open" />
          </div>
        </Swatch>
        <Swatch label="muted, open">
          <div style={{ paddingTop: 112 }}>
            <VolumeControl volume={80} muted onVolumeChange={noop} onToggleMute={noop} force="open" />
          </div>
        </Swatch>
        <Swatch label="closed">
          <VolumeControl volume={80} muted={false} onVolumeChange={noop} onToggleMute={noop} />
        </Swatch>
      </div>
    </section>
  );
}

/** The play/pause morph, large and on a loop, for judging it by eye. */
function MorphDemo() {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setPlaying((current) => !current), 1200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="preview-swatch" style={{ width: 220, alignItems: "center" }}>
      <span>play ⇄ pause, 180 ms, every 1.2 s</span>
      <PlayPauseIcon playing={playing} size={180} />
    </div>
  );
}

function Preview() {
  // ?only=frames, ?only=states or ?only=morph narrows the page down, e.g. for a screenshot.
  const only = new URLSearchParams(window.location.search).get("only");
  if (only === "states") return <StateSheet />;
  if (only === "morph") return <MorphDemo />;

  // ?shot=playing, ?shot=volume or ?shot=error draws one popover alone on a clear page, for the README captures.
  const shot = new URLSearchParams(window.location.search).get("shot");
  if (shot) {
    return (
      <div className="preview-shot">
        {shot === "volume" ? (
          <Frame name="Volume open" volumeOpen />
        ) : shot === "error" ? (
          <Frame name="Rate limited" status="error" currentId="t2" error={strings.errors.rateLimited} retry />
        ) : (
          <Frame name="Playing a two-hour set" />
        )}
      </div>
    );
  }

  return (
    <>
      <h1>Menubar Player · design preview</h1>
      <div className="preview-frames">
        <Frame name="Playing a two-hour set" />
        <Frame name="Volume open" volumeOpen />
        <Frame name="Paused, track removed, muted" status="paused" undo muted />
        <Frame name="Loading" status="loading" currentId="t3" statusLabel={strings.status.loading} time={0} />
        <Frame name="Reconnecting…" recovering statusLabel={strings.status.recovering} />
        <Frame
          name="Errors"
          status="error"
          error={strings.errors.recoveryFailed}
          retry
          addNotice={{ kind: "error", text: strings.errors.notYoutube }}
        />
        <Frame name="Rate limited" status="error" currentId="t2" error={strings.errors.rateLimited} retry />
        <Frame name="Empty library" library={[]} currentId={null} status="idle" title={null} />
        <Frame
          name="Short track, already in the library"
          currentId="t9"
          time={65}
          addNotice={{ kind: "info", text: strings.library.alreadyAdded }}
        />
        <Frame name="Row states" force={{ t2: "hover", t3: "focus", t4: "active" }} status="paused" />
      </div>
      {only !== "frames" && <StateSheet />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <MotionConfig reducedMotion="user">
    <Preview />
  </MotionConfig>,
);

// Every frame holds a URL field that asks for focus; keep the page at the top regardless.
window.setTimeout(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  window.scrollTo(0, 0);
}, 0);
