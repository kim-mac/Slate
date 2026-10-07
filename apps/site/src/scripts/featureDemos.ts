interface DemoEnvironment {
  matchMedia: (query: string) => MediaQueryList;
  IntersectionObserver?: typeof IntersectionObserver;
}

// CSS owns the timelines. Each completed cycle hands playback to the next
// visible card in DOM order, without scrolling or moving keyboard focus.
export function initializeFeatureDemos(
  doc: Document,
  environment: DemoEnvironment,
) {
  const preference = environment.matchMedia('(prefers-reduced-motion: reduce)');
  const states = Array.from(
    doc.querySelectorAll<HTMLElement>('[data-feature-demo]'),
  ).map((element) => ({
    element,
    button: element.querySelector<HTMLButtonElement>('[data-demo-toggle]'),
    visible: false,
  }));
  const byElement = new Map(states.map((state) => [state.element, state]));
  let active: (typeof states)[number] | undefined;
  let paused = false;
  const nextVisible = () => {
    const start = active ? states.indexOf(active) + 1 : 0;
    for (let offset = 0; offset < states.length; offset++) {
      const candidate = states[(start + offset) % states.length];
      if (candidate.visible) return candidate;
    }
    return undefined;
  };
  const update = () => {
    if (!active?.visible) active = nextVisible();
    for (const state of states) {
      const isStatic = preference.matches || !environment.IntersectionObserver;
      const isActive = !isStatic && state === active;
      state.element.dataset.static = String(isStatic);
      state.element.dataset.active = String(isActive);
      state.element.dataset.running = String(
        isActive && state.visible && !paused && !doc.hidden,
      );
      if (state.button) {
        state.button.hidden = isStatic;
        state.button.setAttribute('aria-pressed', String(paused));
        state.button.setAttribute(
          'aria-label',
          `${paused ? 'Resume' : 'Pause'} feature demos`,
        );
        state.button.title = paused ? 'Resume demos' : 'Pause demos';
      }
    }
  };
  const observer = environment.IntersectionObserver
    ? new environment.IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const state = byElement.get(entry.target as HTMLElement);
            if (state) state.visible = entry.isIntersecting;
          }
          update();
        },
        { threshold: 0.1 },
      )
    : undefined;
  const listeners = states.map((state) => {
    const toggle = () => {
      paused = !paused;
      update();
    };
    const advance = (event: AnimationEvent) => {
      // Descendant animations also bubble; only the card's cycle is a handoff.
      if (
        event.target !== state.element ||
        event.animationName !== 'demo-cycle' ||
        state.element.dataset.running !== 'true'
      ) {
        return;
      }
      active = nextVisible();
      update();
    };
    state.button?.addEventListener('click', toggle);
    state.element.addEventListener('animationiteration', advance);
    observer?.observe(state.element);
    return () => {
      state.button?.removeEventListener('click', toggle);
      state.element.removeEventListener('animationiteration', advance);
    };
  });
  preference.addEventListener('change', update);
  doc.addEventListener('visibilitychange', update);
  update();
  return () => {
    observer?.disconnect();
    preference.removeEventListener('change', update);
    doc.removeEventListener('visibilitychange', update);
    for (const remove of listeners) remove();
    for (const state of states) {
      state.element.dataset.running = 'false';
      state.element.dataset.active = 'false';
    }
  };
}
