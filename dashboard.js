
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// ========================================
// المتغيرات الأساسية
// ========================================

const $ = (id) => document.getElementById(id);

const DEFAULT_YEAR = "2026 / 2027";

let currentAcademicYear = DEFAULT_YEAR;
let schoolRecords = [];
let currentSchoolId = null;
let allStudents = [];
let isSaving = false;

// ========================================
// العام الدراسي
// ========================================

function normalizeYear(value) {
  return cleanText(value).replace(/\s*\/\s*/g, " / ");
}

function recordYear(record) {
  return normalizeYear(record.academicYear || DEFAULT_YEAR);
}

function studentYear(student) {
  return normalizeYear(student.academicYear || DEFAULT_YEAR);
}

function getRecordsForYear() {
  return schoolRecords.filter(
    (record) =>
      recordYear(record) === normalizeYear(currentAcademicYear)
  );
}

// ========================================
// التاريخ والوقت
// ========================================

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function localTimeString() {
  const now = new Date();

  return (
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0")
  );
}

function updateDepartureTimeBox() {
  const departureTimeInput = $("departureTime");

  if (departureTimeInput) {
    departureTimeInput.value = localTimeString();
  }
}

updateDepartureTimeBox();
setInterval(updateDepartureTimeBox, 1000);

function formatTime(time) {
  if (!time) return "لا يوجد";

  const [hours, minutes] = time.split(":").map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return time;
  }

  const period = hours >= 12 ? "مساءً" : "صباحًا";
  const hour12 = hours % 12 || 12;

  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s+/g, " ");
}

function newestFirst(a, b) {
  const aDate = `${a.date || ""} ${a.time || ""}`;
  const bDate = `${b.date || ""} ${b.time || ""}`;

  return bDate.localeCompare(aDate);
}

// ========================================
// اسم المدرسة والعام الدراسي
// ========================================

function updatePrintSchoolNames(schoolName) {
  const name = schoolName || "اسم المدرسة";

  if ($("printLateSchoolName")) {
    $("printLateSchoolName").textContent = name;
  }

  if ($("printDepartureSchoolName")) {
    $("printDepartureSchoolName").textContent = name;
  }
}

function updateAcademicYearDisplay() {
  const yearElement = $("dashboardAcademicYear");

  if (yearElement) {
    yearElement.textContent = currentAcademicYear;
  }
}

// ========================================
// حقول الشخص الآخر
// ========================================

function toggleOtherPersonFields() {
  const guardianType = $("guardianType");
  const otherPersonFields = $("otherPersonFields");
  const otherPersonName = $("otherPersonName");

  if (!guardianType || !otherPersonFields) return;

  const isOther = guardianType.value === "شخص آخر";

  otherPersonFields.hidden = !isOther;

  if (otherPersonName) {
    otherPersonName.required = isOther;

    if (!isOther) {
      otherPersonName.value = "";
    }
  }
}

$("guardianType")?.addEventListener(
  "change",
  toggleOtherPersonFields
);

toggleOtherPersonFields();

// ========================================
// التنقل بين أقسام لوحة التحكم
// ========================================

const dashboardLayout = document.querySelector(".dashboard-page");

dashboardLayout?.classList.add("sidebar-collapsed");

function showDashboardView(target) {
  const targetView = document.getElementById(`view-${target}`);

  if (!targetView) {
    console.warn(`القسم غير موجود: view-${target}`);
    return;
  }

  document.querySelectorAll(".dashboard-view").forEach((view) => {
    view.hidden = view !== targetView;
  });

  document.querySelectorAll(".menu-item[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === target);
  });

  const schoolInfoBanner = $("schoolInfoBanner");

  if (schoolInfoBanner) {
    schoolInfoBanner.hidden = target !== "home";
  }
}

document.querySelectorAll(".menu-item[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    showDashboardView(button.dataset.view);
    dashboardLayout?.classList.add("sidebar-collapsed");
  });
});

document.querySelectorAll(".sidebar a").forEach((link) => {
  link.addEventListener("click", () => {
    dashboardLayout?.classList.add("sidebar-collapsed");
  });
});

const params = new URLSearchParams(window.location.search);
const requestedView = params.get("view");

function openRequestedView() {
  if (requestedView) {
    showDashboardView(requestedView);
  }
}

if (document.readyState === "complete") {
  openRequestedView();
} else {
  window.addEventListener("load", openRequestedView, { once: true });
}

// ========================================
// تسجيل الخروج
// ========================================

$("logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "index.html";
  } catch (error) {
    console.error("خطأ في تسجيل الخروج:", error);
    alert("تعذر تسجيل الخروج، حاولي مرة أخرى.");
  }
});


async function loadDepartureStudents() {
  if (!currentSchoolId) return;

  const gradeSelect = $("departureGrade");
  const studentSelect = $("departureStudentName");

  if (!gradeSelect || !studentSelect) {
    console.warn("لم يتم العثور على حقول الصف أو اسم الطالب.");
    return;
  }

  try {
    const studentsRef = collection(
      db,
      "schools",
      currentSchoolId,
      "students"
    );

    const snapshot = await getDocs(studentsRef);

    const loadedStudents = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    allStudents = loadedStudents.filter((student) => {
      const hasName = cleanText(student.name) !== "";
      const hasGrade = cleanText(student.grade) !== "";
      const sameYear =
        studentYear(student) === normalizeYear(currentAcademicYear);
      const isActive = student.isActive !== false;

      return hasName && hasGrade && sameYear && isActive;
    });

    const grades = [
      ...new Set(
        allStudents
          .map((student) => cleanText(student.grade))
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b, "ar"));

    const previousGrade = cleanText(gradeSelect.value);

    gradeSelect.replaceChildren();

    const gradePlaceholder = document.createElement("option");
    gradePlaceholder.value = "";
    gradePlaceholder.textContent = "يرجى اختيار الصف والشعبة";
    gradeSelect.appendChild(gradePlaceholder);

    grades.forEach((grade) => {
      const option = document.createElement("option");
      option.value = grade;
      option.textContent = grade;
      gradeSelect.appendChild(option);
    });

    studentSelect.replaceChildren();

    const studentPlaceholder = document.createElement("option");
    studentPlaceholder.value = "";
    studentPlaceholder.textContent = "يرجى اختيار الصف أولًا";
    studentSelect.appendChild(studentPlaceholder);
    studentSelect.disabled = true;

    if (grades.includes(previousGrade)) {
      gradeSelect.value = previousGrade;
      populateDepartureStudentNames();
    }

    populateDepartureLogGrades();
    populateReportGrades();
    populateLateLogGrades();

    console.log("العام الدراسي المحدد:", currentAcademicYear);
    console.log("عدد الطلاب المحمّلات:", allStudents.length);
    console.log("الصفوف المحمّلة:", grades);
  } catch (error) {
    console.error("خطأ في تحميل الطلاب:", error);

    alert(
      "تعذر تحميل الصفوف وأسماء الطلاب. " +
      "تحققي من اتصال Firebase وصلاحيات قاعدة البيانات."
    );
  }
}


function populateDepartureStudentNames() {
  const gradeSelect = $("departureGrade");
  const studentSelect = $("departureStudentName");

  if (!gradeSelect || !studentSelect) return;

  const selectedGrade = cleanText(gradeSelect.value);

  studentSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";

  if (!selectedGrade) {
    placeholder.textContent = "يرجى اختيار الصف أولًا";
    studentSelect.appendChild(placeholder);
    studentSelect.disabled = true;
    return;
  }

  const students = allStudents
    .filter(
      (student) =>
        cleanText(student.grade) === selectedGrade &&
        cleanText(student.name) !== "" &&
        student.isActive !== false &&
        studentYear(student) === normalizeYear(currentAcademicYear)
    )
    .sort((a, b) =>
      cleanText(a.name).localeCompare(cleanText(b.name), "ar")
    );

  placeholder.textContent = students.length
    ? "يرجى اختيار الطالب"
    : "لا يوجد طلاب في هذا الصف";

  studentSelect.appendChild(placeholder);

  students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = cleanText(student.name);
    studentSelect.appendChild(option);
  });

  studentSelect.disabled = students.length === 0;

  console.log("الصف المختار للمغادرة:", selectedGrade);
  console.log("عدد الطلاب في الصف:", students.length);
}

$("departureGrade")?.addEventListener(
  "change",
  populateDepartureStudentNames
);

// ========================================
// الصفوف في التقارير العامة
// ========================================

function populateReportGrades() {
  const gradeSelect = $("reportGrade");
  if (!gradeSelect) return;

  const previousGrade = gradeSelect.value;

  const grades = [
    ...new Set(
      allStudents
        .map((student) => cleanText(student.grade))
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b, "ar"));

  gradeSelect.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "جميع الصفوف";
  gradeSelect.appendChild(allOption);

  grades.forEach((grade) => {
    const option = document.createElement("option");
    option.value = grade;
    option.textContent = grade;
    gradeSelect.appendChild(option);
  });

  if (grades.includes(previousGrade)) {
    gradeSelect.value = previousGrade;
  }
}

// ========================================
// الصفوف في سجل المغادرات
// ========================================

function populateDepartureLogGrades() {
  const gradeSelect = $("departureLogGrade");
  if (!gradeSelect) return;

  const previousGrade = cleanText(gradeSelect.value);

  const grades = [
    ...new Set(
      allStudents
        .map((student) => cleanText(student.grade))
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b, "ar"));

  gradeSelect.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "جميع الصفوف والشعب";
  gradeSelect.appendChild(allOption);

  grades.forEach((grade) => {
    const option = document.createElement("option");
    option.value = grade;
    option.textContent = grade;
    gradeSelect.appendChild(option);
  });

  if (grades.includes(previousGrade)) {
    gradeSelect.value = previousGrade;
  }

  populateDepartureLogStudents();
}


function populateDepartureLogStudents() {
  const gradeSelect = $("departureLogGrade");
  const studentSelect = $("departureLogStudent");

  if (!gradeSelect || !studentSelect) return;

  const selectedGrade = cleanText(gradeSelect.value);
  const previousStudent = cleanText(studentSelect.value);

  studentSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";

  if (!selectedGrade) {
    placeholder.textContent = "يرجى اختيار الصف أولًا";
    studentSelect.appendChild(placeholder);
    studentSelect.disabled = true;
    return;
  }

  placeholder.textContent = "جميع الطلاب في الصف";
  studentSelect.appendChild(placeholder);

  const students = allStudents
    .filter(
      (student) =>
        cleanText(student.grade) === selectedGrade &&
        cleanText(student.name) !== "" &&
        student.isActive !== false &&
        studentYear(student) === normalizeYear(currentAcademicYear)
    )
    .sort((a, b) =>
      cleanText(a.name).localeCompare(cleanText(b.name), "ar")
    );

  students.forEach((student) => {
    const option = document.createElement("option");
    option.value = cleanText(student.name);
    option.textContent = cleanText(student.name);
    studentSelect.appendChild(option);
  });

  studentSelect.disabled = students.length === 0;

  if (
    previousStudent &&
    students.some(
      (student) => cleanText(student.name) === previousStudent
    )
  ) {
    studentSelect.value = previousStudent;
  }
}

$("departureLogGrade")?.addEventListener("change", () => {
  populateDepartureLogStudents();
  renderDepartureLog();
});

$("departureLogStudent")?.addEventListener(
  "change",
  renderDepartureLog
);

function populateLateLogGrades() {
  const gradeSelect = $("lateLogGrade");
  if (!gradeSelect) return;

  const previousGrade = gradeSelect.value;

  const grades = [
    ...new Set(
      allStudents
        .map((student) => cleanText(student.grade))
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b, "ar"));

  gradeSelect.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "جميع الصفوف";
  gradeSelect.appendChild(allOption);

  grades.forEach((grade) => {
    const option = document.createElement("option");
    option.value = grade;
    option.textContent = grade;
    gradeSelect.appendChild(option);
  });

  if (grades.includes(previousGrade)) {
    gradeSelect.value = previousGrade;
  }

  populateLateLogStudents();
}

function populateLateLogStudents() {
  const gradeSelect = $("lateLogGrade");
  const studentSelect = $("lateLogStudent");

  if (!gradeSelect || !studentSelect) return;

  const selectedGrade = cleanText(gradeSelect.value);
  const previousStudent = studentSelect.value;

  const students = allStudents
    .filter(
      (student) =>
        !selectedGrade ||
        cleanText(student.grade) === selectedGrade
    )
    .sort((a, b) =>
      cleanText(a.name).localeCompare(cleanText(b.name), "ar")
    );

  studentSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = selectedGrade
    ? "جميع الطلاب في الصف"
    : "جميع الطلاب";

  studentSelect.appendChild(placeholder);

  students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = cleanText(student.name);
    studentSelect.appendChild(option);
  });

  studentSelect.disabled = false;

  if (students.some((student) => student.id === previousStudent)) {
    studentSelect.value = previousStudent;
  }

  renderLateLog();
}

$("lateLogGrade")?.addEventListener(
  "change",
  populateLateLogStudents
);

$("lateLogStudent")?.addEventListener(
  "change",
  renderLateLog
);

// ========================================
// الصفوف والإحصائيات
// ========================================

function updateDashboard() {
  const today = localDateString();
  const yearRecords = getRecordsForYear();

  const todayRecords = yearRecords.filter(
    (record) => record.date === today
  );

  const lateRecords = todayRecords.filter(
    (record) => record.type === "late"
  );

  const departureRecords = todayRecords.filter(
    (record) => record.type === "departure"
  );

  if ($("todayDate")) {
    $("todayDate").textContent = today;
  }

  if ($("todayLateCount")) {
    $("todayLateCount").textContent = lateRecords.length;
  }

  if ($("todayDepartureCount")) {
    $("todayDepartureCount").textContent = departureRecords.length;
  }

  const latestLate = [...lateRecords].sort(newestFirst)[0];
  const latestDeparture = [...departureRecords].sort(newestFirst)[0];

  if ($("lastLateTime")) {
    $("lastLateTime").textContent = latestLate
      ? formatTime(latestLate.time)
      : "لا يوجد";
  }

  if ($("lastDepartureTime")) {
    $("lastDepartureTime").textContent = latestDeparture
      ? formatTime(latestDeparture.time)
      : "لا يوجد";
  }

  const recentBody = $("recentRecordsBody");

  if (recentBody) {
    const recent = [...yearRecords].sort(newestFirst).slice(0, 5);
    recentBody.replaceChildren();

    if (!recent.length) {
      addEmptyRow(recentBody, "لا توجد سجلات حاليًا.", 5);
    } else {
      recent.forEach((record) => {
        const row = document.createElement("tr");

        const labels = {
          late: "تأخير",
          departure: "مغادرة",
          absence: "غياب"
        };

        [
          record.studentName || "",
          record.grade || "",
          labels[record.type] || record.type || "",
          record.date || "",
          record.time || ""
        ].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        });

        recentBody.appendChild(row);
      });
    }
  }

  renderLateLog();
  renderDepartureLog();
}

function addEmptyRow(body, message, columnCount) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = columnCount;
  cell.className = "empty-state";
  cell.textContent = message;

  row.appendChild(cell);
  body.appendChild(row);
}

// ========================================
// سجل التأخيرات
// ========================================

function renderLateLog() {
  const body = $("lateRecordsBody");
  if (!body) return;

  const selectedGrade = cleanText(
    $("lateLogGrade")?.value || ""
  );

  const selectedStudentId = cleanText(
    $("lateLogStudent")?.value || ""
  );

  const selectedStudent = allStudents.find(
    (student) => student.id === selectedStudentId
  );

  let records = getRecordsForYear().filter(
    (record) => record.type === "late"
  );

  if (selectedGrade) {
    records = records.filter(
      (record) => cleanText(record.grade) === selectedGrade
    );
  }

  if (selectedStudent) {
    records = records.filter((record) => {
      if (record.studentId) {
        return record.studentId === selectedStudent.id;
      }

      return (
        cleanText(record.studentName) === cleanText(selectedStudent.name) &&
        cleanText(record.grade) === cleanText(selectedStudent.grade)
      );
    });
  }

  records.sort(newestFirst);
  body.replaceChildren();

  if (!records.length) {
    addEmptyRow(
      body,
      selectedStudent
        ? "لا توجد سجلات تأخير لهذا الطالب."
        : "لا توجد سجلات تأخير مطابقة للاختيارات.",
      5
    );
  } else {
    records.forEach((record, index) => {
      const row = document.createElement("tr");

      [
        index + 1,
        record.date || "",
        record.time || "",
        record.reason || "غير محدد",
        record.notes || "—"
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      body.appendChild(row);
    });
  }

  if ($("studentLateTotal")) {
    $("studentLateTotal").textContent = records.length;
  }

  if ($("selectedLateStudent")) {
    $("selectedLateStudent").textContent =
      selectedStudent?.name || "جميع الطلاب";
  }

  const reasonCounts = {};

  records.forEach((record) => {
    const reason = cleanText(record.reason) || "غير محدد";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });

  const topReason = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])[0];

  if ($("studentTopReason")) {
    $("studentTopReason").textContent = topReason
      ? topReason[0]
      : "—";
  }

  if ($("studentTopReasonCount")) {
    $("studentTopReasonCount").textContent = topReason
      ? topReason[1]
      : 0;
  }

  if ($("lateLogMessage")) {
    $("lateLogMessage").textContent = selectedStudent
      ? `تم عرض ${records.length} سجل تأخير للطالب ${selectedStudent.name}.`
      : selectedGrade
        ? `عدد سجلات التأخير للصف المحدد: ${records.length}.`
        : `عدد سجلات التأخير لجميع الطلاب: ${records.length}.`;
  }

  if ($("printStudentName")) {
    $("printStudentName").textContent =
      selectedStudent?.name || "جميع الطلاب";
  }

  if ($("printStudentGrade")) {
    $("printStudentGrade").textContent =
      selectedStudent?.grade || selectedGrade || "جميع الصفوف";
  }

  if ($("printStudentTotal")) {
    $("printStudentTotal").textContent = records.length;
  }

  if ($("printStudentTopReason")) {
    $("printStudentTopReason").textContent = topReason
      ? topReason[0]
      : "—";
  }

  if ($("lateReportHeader")) {
    $("lateReportHeader").hidden = !selectedStudent;
  }
}

function renderDepartureLog() {
  const body = $("departureRecordsBody");
  if (!body) return;

  const selectedGrade = cleanText(
    $("departureLogGrade")?.value || ""
  );

  const selectedStudent = cleanText(
    $("departureLogStudent")?.value || ""
  );

  let records = getRecordsForYear().filter(
    (record) => record.type === "departure"
  );

  if (selectedGrade) {
    records = records.filter(
      (record) => cleanText(record.grade) === selectedGrade
    );
  }

  if (selectedStudent) {
    records = records.filter(
      (record) =>
        cleanText(record.studentName) === selectedStudent
    );
  }

  records.sort(newestFirst);
  body.replaceChildren();

  if (!records.length) {
    addEmptyRow(
      body,
      "لا توجد سجلات مغادرة مطابقة للاختيارات.",
      7
    );
  } else {
    records.forEach((record, index) => {
      const row = document.createElement("tr");

      [
        index + 1,
        record.date || "",
        record.time || "",
        record.reason || "",
        record.guardianType || "",
        record.guardianName || "",
        record.otherPersonPhone || ""
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      body.appendChild(row);
    });
  }

  if ($("studentDepartureTotal")) {
    $("studentDepartureTotal").textContent = records.length;
  }

  if ($("selectedDepartureStudent")) {
    $("selectedDepartureStudent").textContent =
      selectedStudent || "جميع الطلاب";
  }

  if ($("printDepartureStudentName")) {
    $("printDepartureStudentName").textContent =
      selectedStudent || "جميع الطلاب";
  }

  if ($("printDepartureStudentGrade")) {
    $("printDepartureStudentGrade").textContent =
      selectedGrade || "جميع الصفوف والشعب";
  }

  if ($("printDepartureStudentTotal")) {
    $("printDepartureStudentTotal").textContent = records.length;
  }

  if ($("departureLogMessage")) {
    $("departureLogMessage").textContent = selectedStudent
      ? `عدد سجلات المغادرة للطالب ${selectedStudent}: ${records.length}`
      : selectedGrade
        ? `عدد سجلات المغادرة للصف المحدد: ${records.length}`
        : "يرجى اختيار الصف والطالب لعرض سجل المغادرات.";
  }
}

// ========================================
// تحميل السجلات من Firebase
// ========================================

async function loadRecords() {
  if (!currentSchoolId) return;

  const recordsRef = collection(
    db,
    "schools",
    currentSchoolId,
    "records"
  );

  const snapshot = await getDocs(recordsRef);

  schoolRecords = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  updateDashboard();
}

/* ========================================
   عرض التقارير
======================================== */

function getFilteredReportRecords() {
  const fromDate = $("reportFrom")?.value || "";
  const toDate = $("reportTo")?.value || "";
  const reportType = $("reportType")?.value || "all";
  const reportGrade = $("reportGrade")?.value || "all";

  if (fromDate && toDate && fromDate > toDate) {
    return {
      error: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية.",
      records: []
    };
  }

  const records = getRecordsForYear()
    .filter((record) => {
      if (fromDate && (!record.date || record.date < fromDate)) {
        return false;
      }

      if (toDate && (!record.date || record.date > toDate)) {
        return false;
      }

      if (reportType !== "all" && record.type !== reportType) {
        return false;
      }

      if (
        reportGrade !== "all" &&
        cleanText(record.grade) !== cleanText(reportGrade)
      ) {
        return false;
      }

      return true;
    })
    .sort(newestFirst);

  return { error: "", records };
}

function renderReport() {
  const body = $("reportRecordsBody");
  const message = $("reportMessage");

  if (!body) {
    console.error("لم يتم العثور على جدول التقرير reportRecordsBody");
    return;
  }

  const result = getFilteredReportRecords();

  body.replaceChildren();

  if (result.error) {
    addEmptyRow(body, result.error, 7);

    if (message) {
      message.textContent = result.error;
    }

    return;
  }

  const records = result.records;

  if (records.length === 0) {
    addEmptyRow(
      body,
      "لا توجد سجلات مطابقة للاختيارات.",
      7
    );

    if (message) {
      message.textContent =
        `لا توجد سجلات مطابقة للعام الدراسي ${currentAcademicYear}.`;
    }

    return;
  }

  const typeLabels = {
    late: "تأخير",
    departure: "مغادرة",
    absence: "غياب"
  };

  records.forEach((record) => {
    const row = document.createElement("tr");

    const values = [
      record.studentName || "—",
      record.grade || "—",
      typeLabels[record.type] || record.type || "—",
      record.date || "—",
      record.time ? formatTime(record.time) : "—",
      record.reason || "—",
      record.notes || "—"
    ];

    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    body.appendChild(row);
  });

  if (message) {
    message.textContent =
      `تم عرض ${records.length} سجل للعام الدراسي ${currentAcademicYear}.`;
  }

  console.log("عدد سجلات التقرير:", records.length);
}

// ربط زر عرض التقرير
$("generateReportBtn")?.addEventListener("click", renderReport);

// ========================================
// حفظ سجل التأخير أو المغادرة
// ========================================

async function saveRecord(event, type) {
  event.preventDefault();

  if (isSaving) return;

  if (!currentSchoolId) {
    alert("لم يتم تحديد المدرسة.");
    return;
  }

  const isLate = type === "late";

  const selectedStudentValue = cleanText(
    $(isLate ? "lateStudentName" : "departureStudentName")?.value
  );

  const grade = cleanText(
    $(isLate ? "lateGrade" : "departureGrade")?.value
  );

  const selectedStudent = allStudents.find(
    (student) => student.id === selectedStudentValue
  ) || null;

  let studentName = "";

  if (isLate) {
    studentName = selectedStudent
      ? cleanText(selectedStudent.name)
      : selectedStudentValue;
  } else {
    studentName = cleanText(selectedStudent?.name);
  }

  const date =
    $(isLate ? "lateDate" : "departureDate")?.value || "";

  const time = isLate
    ? ($("lateTime")?.value || localTimeString())
    : localTimeString();

  const reason = cleanText(
    $(isLate ? "lateReason" : "departureReason")?.value
  );

  if (!studentName || !grade || !date || !time) {
    alert("يرجى اختيار الطالب والصف وتعبئة التاريخ والوقت.");
    return;
  }

  const matchedLateStudent = isLate
    ? allStudents.find(
        (student) =>
          cleanText(student.name) === studentName &&
          cleanText(student.grade) === grade &&
          studentYear(student) === normalizeYear(currentAcademicYear)
      ) || null
    : null;

  let guardianType = "";
  let guardianName = "";
  let otherPersonPhone = "";

  if (!isLate) {
    guardianType = cleanText($("guardianType")?.value);
    otherPersonPhone = cleanText($("otherPersonPhone")?.value);

    if (!guardianType) {
      alert("يرجى اختيار صلة الشخص المستلم.");
      return;
    }

    if (!otherPersonPhone) {
      alert("يرجى إدخال رقم هاتف الشخص المستلم.");
      return;
    }

    if (guardianType === "شخص آخر") {
      guardianName = cleanText($("otherPersonName")?.value);

      if (!guardianName) {
        alert("يرجى إدخال اسم الشخص المستلم.");
        return;
      }
    } else {
      guardianName = guardianType;
    }

    const studentExists = Boolean(
      selectedStudent &&
      cleanText(selectedStudent.grade) === grade &&
      studentYear(selectedStudent) === normalizeYear(currentAcademicYear) &&
      selectedStudent.isActive !== false
    );

    if (!studentExists) {
      alert(
        "الطالب المحدد غير موجودة في الصف المحدد للعام الحالي. " +
        "يرجى إعادة اختيار الصف والطالب."
      );
      return;
    }
  }

  const record = {
    type,
    studentName,
    grade,
    date,
    time,
    reason: reason || "",
    notes: cleanText($(isLate ? "lateNotes" : "departureNotes")?.value),
    academicYear: currentAcademicYear,
    createdAt: serverTimestamp()
  };

  if (isLate && matchedLateStudent) {
    record.studentId = matchedLateStudent.id;
  }

  if (!isLate) {
    record.studentId = selectedStudent.id;
    record.guardianType = guardianType;
    record.guardianName = guardianName;
    record.otherPersonPhone = otherPersonPhone;
  }

  isSaving = true;

  const submitButton =
    event.submitter || $(isLate ? "lateForm" : "saveDepartureBtn");

  const originalButtonText = submitButton?.textContent;

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "جارٍ الحفظ...";
  }

  try {
    await addDoc(
      collection(db, "schools", currentSchoolId, "records"),
      record
    );

    event.target.reset();

    if (!isLate) {
      toggleOtherPersonFields();
    }

    const dateInput = $(isLate ? "lateDate" : "departureDate");

    if (dateInput) {
      dateInput.value = localDateString();
    }

    updateDepartureTimeBox();

    await loadRecords();
    await loadDepartureStudents();

    if (!isLate) {
      const message = $("departureSaveMessage");

      if (message) {
        message.textContent = "تم حفظ سجل المغادرة بنجاح";
        message.hidden = false;
      }
    } else {
      alert("تم حفظ سجل التأخير بنجاح.");
    }
  } catch (error) {
    console.error("خطأ في حفظ السجل:", error);

    alert(
      "تعذر حفظ السجل. تحققي من اتصال Firebase وصلاحيات قاعدة البيانات."
    );
  } finally {
    isSaving = false;

    if (submitButton) {
      submitButton.disabled = false;

      if (originalButtonText) {
        submitButton.textContent = originalButtonText;
      }
    }
  }
}

$("lateForm")?.addEventListener("submit", (event) => {
  saveRecord(event, "late");
});

$("departureForm")?.addEventListener("submit", (event) => {
  saveRecord(event, "departure");
});

// ========================================
// تسجيل الدخول وتحميل بيانات المدرسة
// ========================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    currentSchoolId = user.uid;

    const schoolSnapshot = await getDoc(
      doc(db, "schools", currentSchoolId)
    );

    if (!schoolSnapshot.exists()) {
      alert("لم يتم العثور على بيانات المدرسة المرتبطة بالحساب.");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    const school = schoolSnapshot.data();

    if (school.ownerUid !== user.uid) {
      alert("لا تملكين صلاحية الوصول إلى بيانات هذه المدرسة.");
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    currentAcademicYear = normalizeYear(
      school.currentAcademicYear || DEFAULT_YEAR
    );

    updateAcademicYearDisplay();

    if ($("dashboardSchoolName")) {
      $("dashboardSchoolName").textContent =
        school.schoolName || "اسم المدرسة";
    }

    updatePrintSchoolNames(school.schoolName);

    if ($("sidebarSchoolName")) {
      $("sidebarSchoolName").textContent =
        school.schoolName || "المدرسة";
    }

    if ($("dashboardSchoolCode")) {
      $("dashboardSchoolCode").textContent =
        school.schoolCode || "—";
    }

    if ($("dashboardGreeting")) {
      $("dashboardGreeting").textContent =
        `أهلًا بك في ${school.schoolName || "مدرستك"}`;
    }

    if ($("lateDate")) {
      $("lateDate").value = localDateString();
    }

    if ($("departureDate")) {
      $("departureDate").value = localDateString();
    }

    await loadDepartureStudents();
    await loadRecords();

    openRequestedView();
  } catch (error) {
    console.error("تعذر تحميل لوحة التحكم:", error);

    alert(
      `رمز الخطأ: ${error.code || "غير معروف"}\n` +
      `التفاصيل: ${error.message || "غير معروفة"}`
    );
  }
});

function escapePrintText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

$("printLateReportBtn")?.addEventListener("click", () => {
  const selectedStudentId = cleanText(
    $("lateLogStudent")?.value || ""
  );

  if (!selectedStudentId) {
    alert("يرجى اختيار الطالب أولًا لطباعة التقرير.");
    return;
  }

  renderLateLog();

  const student = allStudents.find(
    (item) => item.id === selectedStudentId
  );

  if (!student) {
    alert("تعذر العثور على بيانات الطالب.");
    return;
  }

  const body = $("lateRecordsBody");
  const schoolName =
    $("printLateSchoolName")?.textContent || "اسم المدرسة";

  const table = body?.closest("table");

  if (!body || !table) {
    alert("تعذر العثور على جدول سجل التأخيرات.");
    return;
  }

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    alert("يرجى السماح بفتح النوافذ المنبثقة لطباعة التقرير.");
    return;
  }

  const topReason = $("studentTopReason")?.textContent || "—";
  const total = $("studentLateTotal")?.textContent || "0";

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>تقرير تأخيرات الطالب</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          direction: rtl;
          padding: 24px;
          color: #172740;
        }
        h2, .school-name {
          text-align: center;
        }
        .summary {
          margin: 20px 0;
          line-height: 2;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          border: 1px solid #ccc;
          padding: 10px;
          text-align: right;
        }
        th {
          background: #f0f3f8;
        }
        @media print {
          body {
            padding: 0;
          }
        }
      </style>
    </head>
    <body>
      <h2>تقرير تأخيرات الطالب</h2>
      <p class="school-name">${escapePrintText(schoolName)}</p>
      <div class="summary">
        <p>اسم الطالب: ${escapePrintText(student.name)}</p>
        <p>الصف والشعبة: ${escapePrintText(student.grade)}</p>
        <p>العام الدراسي: ${escapePrintText(currentAcademicYear)}</p>
        <p>إجمالي مرات التأخير: ${escapePrintText(total)}</p>
        <p>السبب الأكثر تكرارًا: ${escapePrintText(topReason)}</p>
      </div>
      ${table.outerHTML}
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  printWindow.onload = () => {
    printWindow.print();
  };
});


/* ========================================
   تصدير التقرير إلى Excel
======================================== */

$("exportReportBtn")?.addEventListener("click", () => {
  if (!window.XLSX) {
    alert("تعذر تحميل مكتبة Excel. تحققي من اتصال الإنترنت.");
    return;
  }

  const fromDate = $("reportFrom")?.value || "";
  const toDate = $("reportTo")?.value || "";
  const reportType = $("reportType")?.value || "all";
  const reportGrade = $("reportGrade")?.value || "all";

  const result = getFilteredReportRecords();

  if (result.error) {
    alert(result.error);
    return;
  }

  const records = result.records;

  if (!records.length) {
    alert(
      `لا توجد سجلات للعام ${currentAcademicYear} ضمن الفترة المحددة.`
    );
    return;
  }

  const schoolName =
    $("dashboardSchoolName")?.textContent || "اسم المدرسة";

  const recordTypeLabels = {
    late: "تأخير",
    departure: "مغادرة",
    absence: "غياب"
  };

  const rows = [
    ["اسم المدرسة", schoolName],
    ["العام الدراسي", currentAcademicYear],
    ["من تاريخ", fromDate || "جميع التواريخ"],
    ["إلى تاريخ", toDate || "جميع التواريخ"],
    [
      "نوع التقرير",
      {
        all: "جميع السجلات",
        late: "تقرير التأخير",
        departure: "تقرير المغادرة"
      }[reportType] || reportType
    ],
    [
      "الصف",
      reportGrade === "all" ? "جميع الصفوف" : reportGrade
    ],
    [],
    [
      "اسم الطالب",
      "الصف",
      "نوع السجل",
      "التاريخ",
      "الوقت",
      "السبب",
      "الملاحظات",
      "صلة المستلم",
      "اسم المستلم",
      "رقم الهاتف"
    ],
    ...records.map((record) => [
      record.studentName || "",
      record.grade || "",
      recordTypeLabels[record.type] || record.type || "",
      record.date || "",
      record.time || "",
      record.reason || "",
      record.notes || "",
      record.guardianType || "",
      record.guardianName || "",
      record.otherPersonPhone || ""
    ])
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  worksheet["!cols"] = [
    { wch: 25 },
    { wch: 15 },
    { wch: 18 },
    { wch: 15 },
    { wch: 15 },
    { wch: 30 },
    { wch: 30 },
    { wch: 18 },
    { wch: 25 },
    { wch: 20 }
  ];

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "التقرير"
  );

  const reportName = {
    all: "جميع_السجلات",
    late: "تقرير_التأخير",
    departure: "تقرير_المغادرة"
  }[reportType] || "التقرير";

  const fileName =
    `${reportName}_${currentAcademicYear.replace(/\s/g, "")}_` +
    `${fromDate || "البداية"}_${toDate || "النهاية"}.xlsx`;

  XLSX.writeFile(workbook, fileName);
});

/* ========================================
   طباعة التقرير العام
======================================== */

$("printReportBtn")?.addEventListener("click", () => {
  renderReport();

  const result = getFilteredReportRecords();

  if (result.error) {
    alert(result.error);
    return;
  }

  if (!result.records.length) {
    alert("لا توجد سجلات مطابقة للطباعة.");
    return;
  }

  const table = $("reportRecordsBody")?.closest("table");

  if (!table) {
    alert("تعذر العثور على جدول التقرير.");
    return;
  }

  const schoolName =
    $("dashboardSchoolName")?.textContent || "اسم المدرسة";

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    alert("يرجى السماح بفتح النوافذ المنبثقة للطباعة.");
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>التقرير المدرسي</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          direction: rtl;
          padding: 20px;
        }
        h2, p {
          text-align: center;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          border: 1px solid #ccc;
          padding: 8px;
          text-align: right;
        }
        th {
          background: #eee;
        }
      </style>
    </head>
    <body>
      <h2>التقرير المدرسي</h2>
      <p>${escapePrintText(schoolName)}</p>
      <p>العام الدراسي: ${escapePrintText(currentAcademicYear)}</p>
      ${table.outerHTML}
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.onload = () => printWindow.print();
});



