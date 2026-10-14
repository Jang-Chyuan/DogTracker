# Search relay

When BLE reception is running and an account has a Master set to `phone`, the
foreground UI starts `SearchRelayService`, an Android `dataSync` foreground
service with a persistent notification while pending work exists. Incoming
queue events are batched over ten seconds without a wake lock. The service
stops when the queue is empty; queued events restart it only for the configured
account and an active BLE service. Future retry times use a delayed callback;
offline work waits for a validated-network callback. No empty Headless JS pass
or idle polling loop runs. An active pass has a 25-second JS cancellation
limit and a 26-second native wake-lock/cleanup ceiling; completion releases the
lock immediately. Nonempty queues keep a ten-second cooldown between passes.
Android may defer a background service start; the durable queue and WorkManager
fallback preserve those events. Requests and device power management can
increase actual latency.

Each pass selects each Master/Slave's newest pending event first, then older
events: up to 120, six requests at a time, starting none after 18 s (the JS
task stops at 25 s). A 401 is not charged to the row; a 403 records a refusal
(`ble_upload_refusals`) so the receiver service stops queueing that Master
and its waiting rows wait for 重試, a route change or a successful send.
Refused (blocked) rows do not count toward the 20,000 cap and expire after 7
days (at most 2,000 kept). At the cap the oldest waiting rows are thinned to
one per dog per minute before any is dropped; new packets are always queued. The native queue stores `slave_id`; existing queue rows are migrated
without deleting history. Offline events remain pending with their original
UUIDs. Each request rechecks account, Master setting and queue membership.

Stopping BLE or disabling all phone relay settings stops the service. Logout
also stops it; active tasks poll their native run identity and observe auth
changes. Android data-sync timeouts stop the service and prevent automatic
restart in that process; the UI reports the startup error while foreground
upload and the network-constrained 15-minute WorkManager fallback remain usable.
This does not change the receiver phone's cloud download interval.

## Upload routes (S3)

Each receiver (Master) uploads either by its own Wi-Fi or through this phone;
the route is chosen on 設定 → Supabase 帳號 (S3), after a confirmation. No
receiver uses this phone by default. A switch never deletes queued rows: what
this phone still holds for that receiver is sent first (`UploadService.flush`,
which needs the network); if that cannot finish, the route does not change.
An upload refused with 401 asks `AuthProvider.reportAuthFailure` whether the
sign-in ended (one refresh; refused → 登入失效).
