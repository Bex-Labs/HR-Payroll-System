/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jest-environment-jsdom",
  testMatch: ["**/__tests__/**/*.test.js"],
  collectCoverageFrom: [
    "js/**/*.js",
    "!js/hr-dashboard.js",
    "!js/employee-dashboard.js",
    "!js/manager-dashboard.js",
    "!js/admin-dashboard.js"
  ],
  coverageReporters: ["text", "lcov"],
  verbose: true
};
