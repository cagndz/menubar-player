// Every user-visible string lives here. Technical details never do: they go to the log.
export const strings = {
  status: {
    loading: "Loading…",
    recovering: "Reconnecting…",
  },
  actions: {
    retry: "Try again",
  },
  // Development builds only; the condition lets the bundler drop it from release.
  debug: import.meta.env.DEV
    ? {
        invalidate: "Invalidate (403)",
        expire: "Expire (past date)",
      }
    : null,
  urlInput: {
    label: "YouTube URL",
    placeholder: "https://www.youtube.com/watch?v=…",
    submit: "Add",
    adding: "Adding…",
  },
  controls: {
    play: "Play",
    pause: "Pause",
    progress: "Progress",
    previous: "Previous track",
    next: "Next track",
    repeat: {
      off: "Repeat: off",
      all: "Repeat: all",
      one: "Repeat: one",
    },
    unknownTime: "--:--",
  },
  volume: {
    percent: (volume: number) => `${volume}%`,
    slider: (volume: number) => `Volume: ${volume}%`,
    mute: (volume: number) => `Mute (volume ${volume}%)`,
    unmute: (volume: number) => `Unmute (volume ${volume}%)`,
  },
  library: {
    heading: "Library",
    empty: "Your library is empty. Paste a YouTube link to add a track.",
    alreadyAdded: "Already in your library",
    play: (title: string) => `Play ${title}`,
    pause: (title: string) => `Pause ${title}`,
    remove: "Remove track",
    removed: "Track removed",
    removedSeparator: " · ",
    undo: "Undo",
  },
  errors: {
    invalidUrl: "That isn't a valid link. Paste one that starts with https://.",
    notYoutube: "That isn't a YouTube link. Paste a YouTube video URL.",
    ytdlpMissing: "yt-dlp isn't installed. Run brew install yt-dlp, then try again.",
    noPlayableFormat: "This video has no playable audio format. Try a different video.",
    resolveFailed: "Couldn't load this video. Check the link and your connection, then try again.",
    resolveTimeout: "Loading took too long. Check your connection, then press play again.",
    playbackTimeout: "The audio didn't start. Press play again.",
    playbackFailed: "Playback stopped. The stream may have expired. Press play again.",
    playbackBlocked: "Playback was blocked. Press play to start.",
    rateLimited: "YouTube is limiting requests right now. Try again in a while.",
    cantReachYoutube: "Can't reach YouTube. Check your connection.",
    recoveryFailed: "Couldn't resume this track.",
    storageFailed: "Couldn't save your library. Check your disk space, then try again.",
  },
} as const;
