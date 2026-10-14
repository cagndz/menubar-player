//! The popover fades in and out as a whole, the way Control Center does: the
//! window's own opacity is animated by AppKit (Core Animation), so the shadow
//! fades with it and the webview has nothing to coordinate.
//!
//! A fade can be turned around halfway: it then starts from the opacity the
//! window has at that moment, and a pending hide from the fade it replaced is
//! dropped. With Reduce Motion the window appears and leaves at once.

use std::ptr::NonNull;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use block2::{RcBlock, StackBlock};
use objc2::rc::Retained;
use objc2::Message;
use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSWindow, NSWorkspace};
use objc2_quartz_core::CAMediaTimingFunction;

const FADE_IN: Duration = Duration::from_millis(180);
const FADE_OUT: Duration = Duration::from_millis(200);
/// Core Animation's ease-out: most of the change early, then a long settle.
const EASE_OUT: [f64; 4] = [0.0, 0.0, 0.58, 1.0];

/// A fade under way, as much as is needed to know the opacity at any moment.
#[derive(Clone, Copy, Debug)]
struct Run {
    from: f64,
    to: f64,
    started: Instant,
    duration: Duration,
}

impl Run {
    fn opacity_at(&self, now: Instant) -> f64 {
        if self.duration.is_zero() {
            return self.to;
        }
        let t = now.duration_since(self.started).as_secs_f64() / self.duration.as_secs_f64();
        self.from + (self.to - self.from) * cubic_bezier(EASE_OUT, t.clamp(0.0, 1.0))
    }
}

#[derive(Default)]
struct State {
    /// Bumped by every fade; a fade that finishes after being replaced does nothing.
    generation: u64,
    run: Option<Run>,
    /// Whether the last fade asked for, in or out, was in.
    showing: bool,
}

/// The popover's fades. Clones share the same state.
#[derive(Clone, Default)]
pub struct Fader(Arc<Mutex<State>>);

impl Fader {
    /// Shown, or on its way to being shown.
    pub fn is_showing(&self, window: &NSWindow) -> bool {
        self.0.lock().unwrap().showing && window.isVisible()
    }

    /// Fades the window in. `show` brings it on screen; it runs once the
    /// window is at its starting opacity, so it never flashes at full strength.
    pub fn fade_in(&self, window: &NSWindow, show: impl FnOnce()) {
        let (generation, from) = self.begin(window, true);
        if reduce_motion() {
            window.setAlphaValue(1.0);
            show();
            self.0.lock().unwrap().run = None;
            return;
        }
        window.setAlphaValue(from);
        show();
        self.animate(window, generation, from, 1.0, FADE_IN, None);
    }

    /// Fades the window out, then `hide` takes it off screen; `hide` is
    /// skipped if the popover was shown again in the meantime.
    pub fn fade_out(&self, window: &NSWindow, hide: impl Fn() + 'static) {
        if !window.isVisible() {
            return;
        }
        let (generation, from) = self.begin(window, false);
        if reduce_motion() {
            hide();
            window.setAlphaValue(1.0);
            self.0.lock().unwrap().run = None;
            return;
        }
        window.setAlphaValue(from);
        let state = Arc::clone(&self.0);
        let target = window.retain();
        let done = RcBlock::new(move || {
            if state.lock().unwrap().generation != generation {
                return;
            }
            hide();
            // Off screen now; back at full opacity for whatever shows it next.
            target.setAlphaValue(1.0);
        });
        self.animate(window, generation, from, 0.0, FADE_OUT, Some(done));
    }

    /// Starts a new fade: returns its generation and the opacity to start from.
    fn begin(&self, window: &NSWindow, showing: bool) -> (u64, f64) {
        let mut state = self.0.lock().unwrap();
        state.generation += 1;
        state.showing = showing;
        let from = match (window.isVisible(), state.run) {
            (false, _) => 0.0,
            (true, Some(run)) => run.opacity_at(Instant::now()),
            (true, None) => window.alphaValue(),
        };
        (state.generation, from)
    }

    fn animate(
        &self,
        window: &NSWindow,
        generation: u64,
        from: f64,
        to: f64,
        full: Duration,
        done: Option<RcBlock<dyn Fn()>>,
    ) {
        // Turning around halfway covers only what is left of the way.
        let duration = full.mul_f64((to - from).abs());
        {
            let mut state = self.0.lock().unwrap();
            if state.generation == generation {
                state.run = Some(Run {
                    from,
                    to,
                    started: Instant::now(),
                    duration,
                });
            }
        }
        let target: Retained<NSWindow> = window.retain();
        let changes = StackBlock::new(move |context: NonNull<NSAnimationContext>| {
            // SAFETY: AppKit passes the current animation context, valid for this call.
            let context = unsafe { context.as_ref() };
            context.setDuration(duration.as_secs_f64());
            let [x1, y1, x2, y2] = EASE_OUT.map(|value| value as f32);
            context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
                x1, y1, x2, y2,
            )));
            target.animator().setAlphaValue(to);
        });
        NSAnimationContext::runAnimationGroup_completionHandler(&changes, done.as_deref());
    }
}

fn reduce_motion() -> bool {
    NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

/// A CSS-style cubic Bézier timing curve with fixed ends at (0, 0) and (1, 1),
/// evaluated at time `t`: the same curve Core Animation runs the fade on.
fn cubic_bezier([x1, y1, x2, y2]: [f64; 4], t: f64) -> f64 {
    let sample = |a: f64, b: f64, s: f64| {
        let u = 1.0 - s;
        3.0 * u * u * s * a + 3.0 * u * s * s * b + s * s * s
    };
    // Find the curve parameter whose x is `t`, then read y there.
    let (mut low, mut high) = (0.0, 1.0);
    let mut s = t;
    for _ in 0..30 {
        let x = sample(x1, x2, s);
        if (x - t).abs() < 1e-6 {
            break;
        }
        if x < t {
            low = s;
        } else {
            high = s;
        }
        s = (low + high) / 2.0;
    }
    sample(y1, y2, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eases_out_from_0_to_1() {
        assert_eq!(cubic_bezier(EASE_OUT, 0.0), 0.0);
        assert!((cubic_bezier(EASE_OUT, 1.0) - 1.0).abs() < 1e-6);
        // Most of the change happens early: 0.68 of it by half time, and 0.91
        // by three quarters (values of this curve, worked out separately).
        assert!((cubic_bezier(EASE_OUT, 0.5) - 0.6846).abs() < 0.001);
        assert!((cubic_bezier(EASE_OUT, 0.75) - 0.9065).abs() < 0.001);
        let mut last = 0.0;
        for step in 1..=20 {
            let value = cubic_bezier(EASE_OUT, step as f64 / 20.0);
            assert!(value >= last);
            last = value;
        }
    }

    #[test]
    fn a_fade_turned_around_starts_from_where_it_was() {
        let started = Instant::now();
        let closing = Run {
            from: 1.0,
            to: 0.0,
            started,
            duration: FADE_OUT,
        };
        let halfway = closing.opacity_at(started + FADE_OUT / 2);
        assert!(halfway > 0.0 && halfway < 0.5);
        assert_eq!(closing.opacity_at(started), 1.0);
        assert_eq!(closing.opacity_at(started + FADE_OUT * 2), 0.0);
        // Opening again from there takes only the share of the time that is left.
        assert!(FADE_IN.mul_f64(1.0 - halfway) < FADE_IN);
    }
}
