/** Runs once when the server starts. */
export async function register() {
  // The import must sit inside the check so webpack drops it from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAlertSchedule } = await import("@backend/alerts/schedule");
    startAlertSchedule();
  }
}
