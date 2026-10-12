/* VELoopDO background task reminders. */

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "VELoopDO task reminder",
      body: event.data?.text?.() || "A task is ready for you.",
    };
  }

  const title = payload.title || "VELoopDO · Task reminder";

  const options = {
    body: payload.body || "A scheduled task is ready.",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.taskId
      ? `veloopdo-task-${payload.taskId}`
      : "veloopdo-task-reminder",
    renotify: true,
    requireInteraction: true,
    data: {
      taskId: payload.taskId || "",
      url: payload.url || "/",
    },
    actions: [
      {
        action: "working",
        title: "I'm working",
      },
      {
        action: "snooze",
        title: "Remind me in 7 min",
      },
    ],
    vibrate: [300, 150, 300, 150, 500],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const taskId = event.notification.data?.taskId || "";
  const action = event.action;
  const url = new URL("/", self.location.origin);

  if (taskId) {
    url.searchParams.set("taskId", taskId);
  }

  if (action === "working" || action === "snooze") {
    url.searchParams.set("alarmAction", action);
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(url.href);
          return client.focus();
        }
      }

      return self.clients.openWindow(url.href);
    })(),
  );
});
