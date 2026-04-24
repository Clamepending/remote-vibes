// Credentials baked into the packaged desktop build so Google Calendar /
// Gmail onboarding works for end users without them needing to create their
// own OAuth client in Google Cloud Console.
//
// The real values are written here by .github/workflows/desktop.yml from
// GitHub Actions secrets before `electron-builder` packages the app. The
// checked-in copy intentionally ships empty strings so the repo does not
// leak credentials and local dev builds fall back to BYO OAuth.
//
// OAuth client MUST be type "Desktop app" in Google Cloud Console so that
// loopback redirect URIs (http://127.0.0.1:<port>/...) are accepted without
// pre-registration. See src/create-app.js /api/google/oauth/start.

module.exports = {
  GOOGLE_OAUTH_CLIENT_ID: "",
  GOOGLE_OAUTH_CLIENT_SECRET: "",
};
