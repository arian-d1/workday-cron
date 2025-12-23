import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { timeout } from "cron";
import { sendEmail } from "./mailer.js";
import cron from "node-cron";
import chalk from "chalk";
import { logSuccess, logInfo, logError, logWarning } from "./logging.js";

const WORKDAY_URL = "https://myworkday.ubc.ca";
const COOKIES_FILE = path.resolve("./cookies.json");
const SESSION_DIR = path.resolve("./session");
const OLD_DATA_FILE = path.resolve("./oldData.csv");

const WELCOMEID = '[data-automation-id="pex-welcome-greeting"]';
const ACADEMICSBUTTONID = '[aria-label="Academics"]';
const ACADEMICPROGRESSID = '[data-automation-id="workletTitle"]';
const PROGRESSBUTTONURL =
  "https://wd10.myworkday.com/ubc/d/task/2998$29782.htmld";
const OKBUTTONCLASS = '[class="WGEN WJPI WBLI"]';
const OKBUTTONID = '[data-automation-id="wd-CommandButton_uic_okButton"]';

const GRADETABLEID = '[data-testid="table"]';

const TIMEOUT = 100000;

function arrayToCSV(data) {
  return data
    .map((row) =>
      row
        .map((cell) => `"${cell.replace(/"/g, '""')}"`) // Escape quotes
        .join(","),
    )
    .join("\n");
}

function csvToArray(csv) {
  return csv
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      // This regex matches commas that are NOT inside double quotes
      const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
      if (!matches) return [];
      return matches.map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
    });
}

async function clickButton(page, buttonID, description = "") {
  try {
    logInfo(`Waiting for ${description || buttonID}...`);
    await page.waitForSelector(buttonID, { visible: true, timeout: TIMEOUT });
    await page.click(buttonID);
    logSuccess(`${description || buttonID} clicked`);
  } catch (err) {
    logError(`Failed to click ${description || buttonID}: ${err.message}`);
    throw err;
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: SESSION_DIR,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  try {
    if (fs.existsSync(COOKIES_FILE)) {
      logInfo("Loading saved cookies...");
      const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE));
      await page.setCookie(...cookies);

      await page.goto(WORKDAY_URL, { waitUntil: "networkidle2" });
      logSuccess("Logged in automatically using saved cookies");
    } else {
      logWarning("No cookies found. Manual login required.");
      await page.goto(WORKDAY_URL, { waitUntil: "networkidle2" });
      await page.waitForSelector(WELCOMEID, { visible: true });
      logInfo("Login detected, saving cookies...");
      const cookies = await page.cookies();
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
      logSuccess(`Cookies saved to ${COOKIES_FILE}`);
    }
    await clickButton(page, ACADEMICSBUTTONID, "Academics Button");
    await page.waitForSelector(ACADEMICPROGRESSID, { visible: true });
    logInfo("Navigating to Academic Progress...");
    await page.goto(PROGRESSBUTTONURL, { waitUntil: "networkidle2" });
    await page.waitForSelector(OKBUTTONCLASS, { visible: true });
    await clickButton(page, OKBUTTONID, "OK Button");

    await page.waitForSelector(GRADETABLEID, { visible: true });
    logInfo("Scraping grade table...");

    let grades = await page.$$eval(`${GRADETABLEID} tbody tr`, (rows) =>
      rows
        .map((row) => {
          const cells = row.querySelectorAll("td");
          return [
            cells[3]?.innerText.trim() || "",
            cells[4]?.innerText.trim() || "",
            cells[5]?.innerText.trim() || "",
            cells[6]?.innerText.trim() || "",
          ];
        })
        .filter((row) => row[0].includes("_V")),
    );

    grades = Array.from(new Set(grades.map((row) => row.join("|")))).map(
      (row) => row.split("|"),
    );

    logInfo(`${grades.length} relevant courses found`);

    const newCSV = arrayToCSV(grades);
    let changes = [];

    if (fs.existsSync(OLD_DATA_FILE)) {
      const oldCSV = fs.readFileSync(OLD_DATA_FILE, "utf-8");
      const oldGrades = csvToArray(oldCSV);
      const oldMap = new Map();
      oldGrades.forEach((row) => oldMap.set(row[0], row)); // store as array [Course, Term, Credits, Grade]
      logInfo(oldGrades);
      grades.forEach((row) => {
        const key = row[0]; // Course code
        const newGrade = row[3]; // New grade
        if (!oldMap.has(key)) {
          // New course
          changes.push(
            `NEW COURSE ADDED\nCourse: ${row[0]}\nTerm: ${row[1]}\nCredits: ${row[2]}\nGrade: ${row[3]}`,
          );
          logInfo(`Key: ${JSON.stringify(key)}`);
          logInfo(`New Grade: ${JSON.stringify(newGrade)}`);
        } else {
          const oldRow = oldMap.get(key);
          const oldGrade = oldRow[3];

          if (oldGrade !== newGrade) {
            // Grade has changed (including from "" → "A+" etc.)
            changes.push(
              `GRADE UPDATED\nCourse: ${row[0]}\nOld Grade: ${oldGrade || "N/A"}\nNew Grade: ${newGrade || "N/A"}\nTerm: ${row[1]}, Credits: ${row[2]}`,
            );
          }
        }
      });
    } else {
      // No old data → consider all courses as new
      grades.forEach((row) => {
        changes.push(
          `NEW COURSE ADDED\nCourse: ${row[0]}\nTerm: ${row[1]}\nCredits: ${row[2]}\nGrade: ${row[3]}`,
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
    logError(`Main process failed: ${err.message}`);
  } finally {
    await browser.close();
    logInfo("Browser closed");
  }
}

// (5 MINS) (EVERY HR) (EVERY DAY OF MONTH) (EVERY MONTH) (EVERY DAY OF WEEK)
logInfo(`Scheduler started at ${new Date().toLocaleTimeString()}`);
// Uncomment this to local run the cron as a script
// cron.schedule("*/5 * * * *", async () => {
//   logInfo("Running Workday grade check...");
//   await main();
// });

await main();
