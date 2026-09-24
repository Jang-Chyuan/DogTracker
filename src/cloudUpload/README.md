# Search relay

When BLE reception is running and an account has a Master set to `phone`, the
foreground UI starts `SearchRelayService`, an Android `dataSync` foreground
service with a persistent notification. Its native 10-second timer launches a
bounded Headless JS upload pass, including while the screen is off. No new pass
starts while the previous pass is active. Requests, network availability and
device power management can increase actual latency.

Each pass selects each Master/Slave's newest pending event first, then older
events. The native queue stores `slave_id`; existing queue rows are migrated
without deleting history. Offline events remain pending with their original
UUIDs. Each request rechecks account, Master setting and queue membership.

Stopping BLE or disabling all phone relay settings stops the service. Logout
also stops it; active tasks poll their native run identity and observe auth
changes. Android data-sync timeouts stop the service and prevent automatic
restart in that process; the UI reports the startup error while foreground
upload and the network-constrained 15-minute WorkManager fallback remain usable.
This does not change the receiver phone's cloud download interval.
