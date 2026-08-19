import { prisma, withOrgContext } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { MarkNotificationReadButton } from "@/components/mark-notification-read-button";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireRole("VIEWER");
  const db = withOrgContext(prisma, user.organizationId);
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        isRead: true,
        createdAt: true,
      },
    }),
    db.notification.count({ where: { organizationId: user.organizationId, isRead: false } }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Notifications</h1>
        <p className="text-sm text-slate-500">
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        </p>
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-slate-500">
          No notifications yet. Run a scan, analyze a change, or create a draft PR and they will
          appear here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`flex items-start justify-between gap-4 px-4 py-3 ${
                notification.isRead ? "opacity-60" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {!notification.isRead ? (
                    <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-red-600" />
                  ) : null}
                  <p className="truncate text-sm font-medium text-slate-900">
                    {notification.title}
                  </p>
                </div>
                {notification.body ? (
                  <p className="mt-0.5 text-sm text-slate-600">{notification.body}</p>
                ) : null}
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(notification.createdAt).toLocaleString()} · {notification.type}
                </p>
              </div>
              {!notification.isRead ? (
                <MarkNotificationReadButton notificationId={notification.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
