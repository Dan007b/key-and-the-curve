// Entry point. Phase 0: blank page. The disk view, HUD and input wiring
// are added in later phases.

const app = document.getElementById('app');
if (!app) {
  throw new Error('#app element missing from index.html');
}
