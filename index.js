import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { sendEmail } from "./mailer.js";
import cron from "node-cron";
import { logSuccess, logInfo, logError, logWarning } from "./logging.js";
import dotenv from "dotenv";

dotenv.config();

const WORKDAY_URL = "https://myworkday.ubc.ca";
const COOKIES_FILE = path.resolve("./cookies.json");
const SESSION_DIR = path.resolve("./session");
const OLD_DATA_FILE = path.resolve("./oldData.csv");

const USERNAMESELECTOR = "#username";
const PASSWORDSELECTOR = "#password";

const WELCOMEID = '[data-automation-id="pex-welcome-greeting"]';
const ACADEMICSBUTTONID = '[aria-label="Academics"]';
const ACADEMICPROGRESSID = '[data-automation-id="workletTitle"]';
const ACADEMICRECORDURL =
  "https://wd10.myworkday.com/ubc/d/task/2998$30300.htmld";


const GRADETABLEID = '[data-testid="table"]';

const TIMEOUT = 100000;
const { CWL, CWLPW } = process.env;

// Convert array of grade objects to CSV
function arrayToCSV(data) {
  // data = [{ course, grade, percent, credits }, ...]
  const header = ["Course", "Grade", "Percent", "Credits"];
  const rows = data.map((row) =>
    [
      row.course.replace(/"/g, '""'),
      row.grade.replace(/"/g, '""'),
      row.percent.replace(/"/g, '""'),
      row.credits.replace(/"/g, '""'),
    ]
      .map((cell) => `"${cell}"`)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

// Convert CSV string to array of grade objects
function csvToArray(csv) {
  const lines = csv.split("\n").filter((line) => line.trim() !== "");
  // Skip header
  return lines
    .slice(1)
    .map((line) => {
      // Regex to split CSV respecting quotes
      const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
      if (!matches) return null;
      const [course, grade, percent, credits] = matches.map((c) =>
        c.replace(/^"|"$/g, "").replace(/""/g, '"'),
      );
      return { course, grade, percent, credits };
    })
    .filter(Boolean);
}

async function clickButton(page, buttonID, description = "") {
  try {
    logInfo(`Waiting for ${description || buttonID}...`);
    await page.waitForSelector(buttonID, { visible: true, timeout: TIMEOUT });
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(3000);
    await page.click(buttonID);
    logSuccess(`${description || buttonID} clicked`);
  } catch (err) {
    logError(`Failed to click ${description || buttonID}: ${err.message}`);
    throw err;
  }
}

async function isLoggedOut(page) {
  let res = await page.$(USERNAMESELECTOR);
  return res || false;
}

async function login(page, message = "") {
  try {
    await page.waitForSelector(USERNAMESELECTOR, { visible: true });
    await page.waitForSelector(PASSWORDSELECTOR, { visible: true });
    await page.type(USERNAMESELECTOR, CWL);
    await page.type(PASSWORDSELECTOR, CWLPW);
    await page.keyboard.press("Enter");

    await page.waitForSelector(WELCOMEID, {
      visible: true,
      timeout: TIMEOUT,
    });

    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    logSuccess(message);
  } catch (err) {
    throw err;
  }
}

async function loadCookies(page) {
  if (fs.existsSync(COOKIES_FILE)) {
    logInfo("Loading saved cookies...");
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE));
    await page.setCookie(...cookies);
    await page.goto(WORKDAY_URL, { waitUntil: "networkidle2" });

    if (await isLoggedOut(page)) {
      logWarning("Cookies expired. Re-logging in...");
      await login(page, "Cookies refreshed after login.");
    } else {
      logSuccess("Logged in automatically using saved cookies.");
    }
  } else {
    logWarning("No cookies found... Logging in");
    await page.goto(WORKDAY_URL, { waitUntil: "networkidle2" });
    await login(page, `Cookies saved to ${COOKIES_FILE}`);
  }
}

async function goToGradeTable(page) {
  await clickButton(page, ACADEMICSBUTTONID, "Academics Button");
  await page.waitForSelector(ACADEMICPROGRESSID, { visible: true });
  page.goto(ACADEMICRECORDURL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(GRADETABLEID, { visible: true });
}

async function parseGrades(page) {
  logInfo("Scraping grade table...");

  let grades = await page.$$eval(`${GRADETABLEID} tbody tr`, (rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll("td")).map((td) => td.innerText.trim()),
    ),
  );

  grades = grades
    .filter((row) => (row[1] || "").includes("_V"))
    .map((row) => ({
      course: row[1],
      grade: row[2] || "",
      percent: row[3] || "",
      credits: row[4] || "",
    }));

  grades = Array.from(new Map(grades.map((g) => [g.course, g])).values());

  logInfo(`${grades.length} relevant courses found`);

  return grades;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: SESSION_DIR,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  try {
    await loadCookies(page);
    await goToGradeTable(page);

    let grades = await parseGrades(page);

    const newCSV = arrayToCSV(grades);
    let changes = [];

    if (fs.existsSync(OLD_DATA_FILE)) {
      const oldCSV = fs.readFileSync(OLD_DATA_FILE, "utf-8");
      const oldGrades = csvToArray(oldCSV); // [{course, grade, percent, credits}, ...]

      // Map old grades by course code for easy lookup
      const oldMap = new Map();
      oldGrades.forEach((row) => oldMap.set(row.course, row));

      grades.forEach((row) => {
        const key = row.course;
        const newGrade = row.grade;
        const newPercent = row.percent;

        if (!oldMap.has(key)) {
          // New course added
          changes.push(
            `NEW COURSE ADDED\nCourse: ${row.course}\nGrade: ${row.grade}\nPercent: ${row.percent}\nCredits: ${row.credits}`,
          );
        } else {
          const oldRow = oldMap.get(key);
          const oldGrade = oldRow.grade;
          const oldPercent = oldRow.percent;

          if (oldGrade !== newGrade || oldPercent !== newPercent) {
            // Grade or percent has changed
            changes.push(
              `GRADE UPDATED\nCourse: ${row.course}\nOld Grade: ${oldGrade || "N/A"}\nNew Grade: ${newGrade || "N/A"}\nOld Percent: ${oldPercent || "N/A"}\nNew Percent: ${newPercent || "N/A"}\nCredits: ${row.credits}`,
            );
          }
        }
      });
    } else {
      // No old data → consider all courses as new
      grades.forEach((row) => {
        changes.push(
          `NEW COURSE ADDED\nCourse: ${row.course}\nGrade: ${row.grade}\nPercent: ${row.percent}\nCredits: ${row.credits}`,
        );
      });
    }
    if (changes.length > 0) {
      logSuccess(`${changes.length} change(s) detected`);
      await sendEmail(
        "Workday Grade Update Detected",
        changes.join("\n----------------\n"),
      );
      logSuccess("Email notification sent");
    } else {
      logInfo("No changes detected");
    }

    fs.writeFileSync(OLD_DATA_FILE, newCSV, "utf-8");
    logInfo(`${OLD_DATA_FILE} updated`);
  } catch (err) {
    throw err;
  } finally {
    await browser.close();
    logInfo("Browser closed");
  }
}

// (5 MINS) (EVERY HR) (EVERY DAY OF MONTH) (EVERY MONTH) (EVERY DAY OF WEEK)
logInfo(`Scheduler started at ${new Date().toLocaleTimeString()}`);

// Uncomment this to run the cron schedule locally
// cron.schedule("*/5 * * * *", async () => {
//   logInfo("Running Workday grade check...");
//   try {
//       await main();
//   } catch (err) {
//       logError(`CRON execution failed: ${err.message}`);
//       await sendEmail("Workday Grade Checker ERROR", `Error details:\n${err.stack}`);
//   }
// });

try {
  await main();
} catch (err) {
  logError(`Execution failed: ${err.message}`);
  await sendEmail(
    "Workday Grade Checker ERROR",
    `An error occurred during execution:\n\n${err.stack}`,
  );
}
