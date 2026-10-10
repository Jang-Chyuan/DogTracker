# Latest-first UI evidence

Two native release screenshots captured on existing emulator 5562 with a private in-memory QA adapter. This adapter supplies independently invented inputs to the actual screens; it does not sign in to Supabase or download remote data. The account qa@example.invalid is fictional.

- latest-success-archive-pending.png: accepted latest snapshot, background archive pending, real account screen separates latest success from archive status.
- complete-history-loading.png: selected-day coverage proof absent; actual history hook blocks its model, route, and export and displays the new partial-record loading text.

QA source c40e6c04 includes reviewed dog/phone integration and production cloud UI equivalent to 2bf9e852. APK SHA256 420b557717420fc1ef56f316f98a35dbe762e2b100eb16543ad289cdc3a38e04, release and 21 Kotlin suites / 79 tests passed. These images explain UI states, not remote network acceptance or the PR's standalone APK. Actual authenticated 5554 acceptance is reported separately without publishing user screenshots.
