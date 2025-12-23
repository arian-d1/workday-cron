# Workday Grade Checker

This script automatically checks UBC Workday grades and sends an email if there are any updates.

---

## Running in a Terminal as a CRON job

1. Open `index.js` (or your main JS file).  
2. Locate the section for the cron schedule:

```js
// (5 MINS) (EVERY HR) (EVERY DAY OF MONTH) (EVERY MONTH) (EVERY DAY OF WEEK)
logInfo(`Scheduler started at ${new Date().toLocaleTimeString()}`);
// Uncomment this to run the cron schedule locally
// cron.schedule("*/5 * * * *", async () => {
//   logInfo("Running Workday grade check...");
//   await main();
// });

await main();
```
3. Uncomment the cron.schedule block if you want the script to run automatically every 5 minutes in a terminal.
4. Save the file and run:
```js
node index.js
```
* All output and errors will be logged to logs.txt if your .bat file redirects output.
* Use this method for testing or manual execution.

## Running Automatically with Task Scheduler (No Popup Window)

1. Locate the VBScript file in the repo and ensure the path matches where you cloned the project.
2. Open Task Scheduler as Administrator:
    * Press Win + R, type taskschd.msc, and press Enter.
3. Create a new task:
    * General: Give it a name, e.g., Workday Grade Checker.
    * Triggers: Set your schedule (for example, Dec 15 → Jan 5, Apr 15 → May 5).
    * Actions: Browse to your .vbs file.
    * Optional: Set Run whether user is logged on or not for unattended execution.
4. Save the task. The script will now run automatically according to your schedule without flashing a Command Prompt window.

## Email Notifications (Nodemailer)

* This script uses Nodemailer to send email notifications whenever grades are added or updated.
* Configure your email account and credentials via environment variables.

## Notes

* logs.txt will be created automatically if it does not exist and will append new logs each run.
* Ensure Node.js is installed and available in your system PATH.