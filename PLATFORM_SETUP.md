# Lesson Prep Platform Setup

This version separates teacher plans by Google account. The browser gets a Google ID token, and the Apps Script backend verifies that token before reading or saving lesson data.

## Files

- `index.html`: teacher editor.
- `view.html`: read-only view link.
- `admin.html`: control dashboard to add teachers.
- `platform-config.js`: public front-end config.
- `backend.gs`: Google Apps Script backend template.

## Google Setup

1. Create a Google Cloud OAuth Web Client ID.
2. Add that client ID to:
   - `platform-config.js` as `googleClientId`
   - `backend.gs` as `GOOGLE_CLIENT_ID`
3. Create one Google Spreadsheet to be the control database.
4. Paste its spreadsheet ID into `backend.gs` as `CONTROL_SPREADSHEET_ID`.
5. Update `ADMIN_EMAILS` in both `platform-config.js` and `backend.gs`.
6. Deploy `backend.gs` as a Google Apps Script Web App.
7. Paste the Web App URL into `platform-config.js` as `gasUrl`.

## Data Model

The control spreadsheet stores the teacher registry in a `Teachers` tab:

- `email`
- `name`
- `classes`
- `spreadsheetId`
- `active`
- `createdAt`

When an admin adds a teacher, the backend creates a separate spreadsheet for that teacher. Lesson rows are stored in that teacher spreadsheet, not in a shared classroom file.

## Security Rules

- A teacher can read and save only their own spreadsheet.
- An admin can add teachers and read teacher plans.
- The front end does not decide access. It only sends the Google ID token.
- The backend verifies the token audience and verified email before any read/write.

Do not rely on URL parameters like `class` or `teacherEmail` for security. They are only routing hints; `backend.gs` enforces the actual permission checks.
