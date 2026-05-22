# Lesson Prep Platform Documentation

This app is a bilingual lesson-prep platform for multiple teachers. Each teacher logs in with Google, edits only their own lesson plans, and the admin can register teachers from a control dashboard.

## Main Pages

- `index.html`: lesson editor used by teachers.
- `view.html`: read-only lesson view for sharing with the advisor.
- `admin.html`: admin dashboard for adding and managing teachers.
- `platform-config.js`: front-end configuration.
- `backend.gs`: Google Apps Script backend code.

## Roles

### Admin

The admin can:

- Add teachers.
- Register the teacher's Gmail address.
- Define which classes the teacher works with.
- Open the teacher's generated Google Spreadsheet.
- Access teacher lesson plans when needed.

Admin access is controlled by the `ADMIN_EMAILS` list in:

- `platform-config.js`
- `backend.gs`

The backend is the important one for security. The front-end list only controls what the interface shows.

### Teacher

A teacher can:

- Sign in with their registered Gmail account.
- Edit lesson plans for their own account.
- Save lesson plans.
- Share a read-only view link with the advisor.

A teacher cannot access another teacher's plans unless their email is listed as an admin in the backend.

## How The Data Is Stored

The platform uses Google Sheets through Google Apps Script.

There are two types of spreadsheets:

1. Control spreadsheet
2. Teacher spreadsheets

### Control Spreadsheet

This spreadsheet stores the teacher registry. It has a tab called `Teachers`.

Columns:

- `email`: teacher Gmail.
- `name`: teacher name.
- `classes`: classes assigned to the teacher.
- `spreadsheetId`: the private spreadsheet created for that teacher.
- `active`: whether the teacher account is enabled.
- `createdAt`: date the teacher was added.

### Teacher Spreadsheet

Each teacher gets their own spreadsheet. This is where their lesson plans are stored.

The backend creates this spreadsheet automatically when the admin adds the teacher.

The teacher spreadsheet has a tab called `Lessons`.

Columns:

- `key`: unique lesson key.
- `json`: saved lesson data.
- `updatedAt`: last save date.
- `updatedBy`: email that saved the plan.

The lesson key is made from:

- bimestre
- week
- class

Teacher isolation is not based only on this key. The backend also checks the logged-in Google email.

## First-Time Setup

### 1. Create A Google Cloud OAuth Client

Create a Google OAuth Web Client ID for the app.

Add the local and production origins you will use, for example:

- `http://127.0.0.1:8080`
- your published website domain

After creating it, copy the client ID.

### 2. Update `platform-config.js`

Open `platform-config.js` and set:

```js
window.LESSON_PREP_CONFIG = {
  gasUrl: "YOUR_APPS_SCRIPT_WEB_APP_URL",
  googleClientId: "YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID",
  adminEmails: [
    "your-admin-email@gmail.com"
  ],
};
```

### 3. Create The Control Spreadsheet

Create a blank Google Spreadsheet.

Copy the spreadsheet ID from the URL.

Example URL:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_IS_HERE/edit
```

### 4. Deploy The Backend

Create a Google Apps Script project.

Paste the contents of `backend.gs` into the Apps Script editor.

At the top of `backend.gs`, update:

```js
const CONTROL_SPREADSHEET_ID = "YOUR_CONTROL_SPREADSHEET_ID";
const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID";
const ADMIN_EMAILS = ["your-admin-email@gmail.com"];
```

Deploy the script as a Web App.

Recommended deployment settings:

- Execute as: yourself or the script owner.
- Who has access: anyone with the link, or your organization if you use Google Workspace.

The backend still verifies Google login tokens, so users cannot access private teacher data just because they have the link.

After deployment, copy the Web App URL and place it in `platform-config.js` as `gasUrl`.

## How To Use The Admin Dashboard

Open:

```text
http://127.0.0.1:8080/admin.html
```

Or, after publishing:

```text
https://your-site/admin.html
```

Steps:

1. Sign in with a Google account listed in `ADMIN_EMAILS`.
2. Fill in the teacher name.
3. Fill in the teacher Gmail.
4. Fill in the classes, for example `Infantil 3, Infantil 4`.
5. Click `Add Teacher`.

When you add a teacher:

- The teacher is added to the control spreadsheet.
- A new private teacher spreadsheet is created.
- The teacher can now log in with their Gmail.

## How Teachers Use The App

Open:

```text
http://127.0.0.1:8080/index.html
```

Or, after publishing:

```text
https://your-site/index.html
```

Steps:

1. Sign in with the registered Gmail account.
2. Select the bimestre.
3. Select the week.
4. Select the class.
5. Fill in the lesson plan.
6. Click `Salvar`.

The lesson is saved only inside that teacher's spreadsheet.

## How To Share With The Advisor

The teacher clicks:

```text
Compartilhar com o Advisor
```

The app creates a read-only link using `view.html`.

The link includes:

- bimestre
- week
- class
- teacher email

The advisor can see the lesson in read-only mode, but access is still controlled by the backend. If you want advisors to access all teachers, add advisor emails to `ADMIN_EMAILS` in `backend.gs`.

## Local Testing

From the project folder, run:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/index.html
http://127.0.0.1:8080/admin.html
http://127.0.0.1:8080/view.html
```

Do not test Google Sign-In from `file://` if possible. Use `localhost` or `127.0.0.1`.

## Security Notes

The important security rule is:

The browser is not trusted.

The browser can send:

- teacher email
- class
- week
- lesson key

But those values can be changed by a user. Because of that, `backend.gs` verifies the Google ID token and checks the logged-in email before reading or writing data.

The backend allows access only when:

- the logged-in email is the same as the teacher email, or
- the logged-in email is listed in `ADMIN_EMAILS`

This is what prevents one teacher from opening another teacher's plan.

## Common Problems

### Google Sign-In does not appear

Check:

- `googleClientId` is filled in `platform-config.js`.
- The Google Identity script loads in the browser.
- The current domain is authorized in the Google OAuth client.

### Login works, but saving fails

Check:

- `gasUrl` is correct in `platform-config.js`.
- `GOOGLE_CLIENT_ID` is correct in `backend.gs`.
- `CONTROL_SPREADSHEET_ID` is correct in `backend.gs`.
- The Apps Script deployment is updated after code changes.

### Teacher sees "Access denied"

Check:

- The teacher was added in `admin.html`.
- The teacher is logging in with the exact Gmail registered.
- The teacher is active in the control spreadsheet.

### Admin cannot open the dashboard data

Check:

- The admin Gmail is listed in `ADMIN_EMAILS` in `backend.gs`.
- The admin is signing in with that same Google account.
- The Apps Script deployment was updated after changing `ADMIN_EMAILS`.

## Recommended Workflow

1. Configure Google OAuth.
2. Configure and deploy `backend.gs`.
3. Add yourself as admin.
4. Open `admin.html`.
5. Add the 10 teachers.
6. Ask each teacher to log in with their registered Gmail.
7. Have teachers save one test lesson.
8. Confirm each teacher cannot access another teacher's plan.

## Current Limitation

This version uses Google Apps Script and Google Sheets because it is fast to deploy and fits the current app. For a larger school-wide system, a future version should use a real backend database with proper sessions, audit logs, and role management.
