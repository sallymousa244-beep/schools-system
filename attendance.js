
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// =====================================
// المتغيرات الأساسية
// =====================================

const DEFAULT_YEAR = "2026 / 2027";

let currentSchoolId = "";
let currentAcademicYear = DEFAULT_YEAR;
let allStudents = [];
let allRecords = [];
let isSaving = false;
let isLoading = false;

// =====================================
// عناصر الصفحة
// =====================================

const $ = id => document.getElementById(id);

const gradeSelect = $("gradeSelect");
const lessonSelect = $("lessonSelect");
const attendanceDate = $("attendanceDate");
const teacherName = $("teacherName");
const studentSelect = $("studentSelect");
const studentStatusList = $("studentStatusList");
const studentStatusPreview = $("studentStatusPreview");
const saveAttendanceBtn = $("saveAttendanceBtn");
const refreshListBtn = $("refreshListBtn");
const pageMessage = $("pageMessage");
const todayDate = $("todayDate");

const statusGradeFilter = $("statusGradeFilter");
const statusLessonFilter = $("statusLessonFilter");
const studentsBody = $("studentsBody");

const filterGrade = $("filterGrade");
const filterLesson = $("filterLesson");
const filterDate = $("filterDate");
const filterStatus = $("filterStatus");
const filterTeacher = $("filterTeacher");
const filterStudent = $("filterStudent");
const applyFiltersBtn = $("applyFiltersBtn");
const clearFiltersBtn = $("clearFiltersBtn");
const absenceRecordsBody = $("absenceRecordsBody");
const recordsCount = $("recordsCount");

// =====================================
// التاريخ والوقت
// =====================================

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getLocalTime() {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatDate(dateString) {
  if (!dateString) return "—";

  const parts = dateString.split("-");

  if (parts.length !== 3) return dateString;

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getRecordTime(record) {
  if (record.time) return record.time;
  if (record.departureTime) return record.departureTime;

  if (record.createdAt?.toDate) {
    return record.createdAt.toDate().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  return "—";
}

// =====================================
// الرسائل
// =====================================

function showMessage(message, type = "info") {
  if (!pageMessage) return;

  pageMessage.textContent = message;
  pageMessage.className = `attendance-message ${type}`;
}

function clearMessage() {
  if (!pageMessage) return;

  pageMessage.textContent = "";
  pageMessage.className = "attendance-message";
}

// =====================================
// حماية النصوص
// =====================================

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


async function loadStudents() {
  if (!currentSchoolId) {
    throw new Error("لم يتم تحديد المدرسة الحالية.");
  }

  const studentsRef = collection(
    db,
    "schools",
    currentSchoolId,
    "students"
  );

  const snapshot = await getDocs(studentsRef);

  allStudents = snapshot.docs
    .map(item => ({
      id: item.id,
      ...item.data()
    }))
    .filter(student => {
      const year = String(
        student.academicYear || DEFAULT_YEAR
      ).trim();

      return (
        student.isActive !== false &&
        year === currentAcademicYear &&
        String(student.name || "").trim() !== "" &&
        String(student.grade || "").trim() !== ""
      );
    });

  console.log("العام الدراسي:", currentAcademicYear);
  console.log("عدد الطلاب:", allStudents.length);
  console.log("الصفوف والشعب:", getGrades());

  if (allStudents.length === 0) {
    console.warn(
      "لم يتم العثور على طلاب مطابقة للعام الدراسي الحالي."
    );
  }
}

// =====================================
// تحميل سجلات الغياب والمغادرات
// =====================================

async function loadRecords() {
  if (!currentSchoolId) {
    throw new Error("لم يتم تحديد المدرسة الحالية.");
  }

  const recordsRef = collection(
    db,
    "schools",
    currentSchoolId,
    "records"
  );

  const snapshot = await getDocs(recordsRef);

  allRecords = snapshot.docs
    .map(item => ({
      id: item.id,
      ...item.data()
    }))
    .filter(record => {
      const year = String(
        record.academicYear || DEFAULT_YEAR
      ).trim();

      return (
        year === currentAcademicYear &&
        ["absence", "departure"].includes(record.type)
      );
    });
}

// =====================================
// تحميل بيانات المدرسة
// =====================================

async function loadSchool(user) {
  currentSchoolId = user.uid;

  const schoolRef = doc(db, "schools", currentSchoolId);
  const schoolSnapshot = await getDoc(schoolRef);

  if (!schoolSnapshot.exists()) {
    throw new Error("لم يتم العثور على بيانات المدرسة.");
  }

  const school = schoolSnapshot.data();

  if (school.ownerUid !== user.uid) {
    throw new Error("لا توجد صلاحية للوصول إلى بيانات المدرسة.");
  }

  currentAcademicYear = String(
    school.currentAcademicYear || DEFAULT_YEAR
  ).trim();

  const schoolNameElement = $("sidebarSchoolName");

  if (schoolNameElement) {
    schoolNameElement.textContent =
      school.schoolName || "المدرسة";
  }

  const savedTeacher = localStorage.getItem(
    "attendanceTeacherName"
  );

  if (teacherName && !teacherName.value.trim()) {
    teacherName.value =
      savedTeacher || user.displayName || "";
  }

  await loadStudents();
  await loadRecords();

  populateGradeOptions();
  populateStatusGradeOptions();
  populateFilterGradeOptions();

  renderStudentSelectionList();
  renderStudents();
  renderStudentStatus();
  renderRecords();

  if (allStudents.length === 0) {
    showMessage(
      `تم تحميل بيانات المدرسة، لكن لا يوجد طلاب للعام الدراسي ${currentAcademicYear}. تحققي من بيانات الطلاب في Firebase.`,
      "error"
    );
  } else {
    showMessage(
      `تم تحميل ${allStudents.length} طلاب للعام الدراسي ${currentAcademicYear}.`,
      "success"
    );
  }
}

// =====================================
// الصفوف والشعب
// =====================================

function getGrades() {
  return [...new Set(
    allStudents
      .map(student => String(student.grade || "").trim())
      .filter(Boolean)
  )];
}

// =====================================
// تعبئة الصفوف في نموذج الغياب
// =====================================

function populateGradeOptions() {
  if (!gradeSelect) return;

  const selectedValue = gradeSelect.value;

  gradeSelect.innerHTML =
    '<option value="">اختر الصف والشعبة</option>';

  getGrades().forEach(grade => {
    const option = document.createElement("option");
    option.value = grade;
    option.textContent = grade;
    gradeSelect.appendChild(option);
  });

  if (getGrades().includes(selectedValue)) {
    gradeSelect.value = selectedValue;
  }

  updateStudentOptions();
}

function populateStatusGradeOptions() {
  if (!statusGradeFilter) return;

  const selectedValue = statusGradeFilter.value;

  statusGradeFilter.innerHTML =
    '<option value="">اختر الصف والشعبة</option>';

  getGrades().forEach(grade => {
    const option = document.createElement("option");
    option.value = grade;
    option.textContent = grade;
    statusGradeFilter.appendChild(option);
  });

  if (getGrades().includes(selectedValue)) {
    statusGradeFilter.value = selectedValue;
  }
}

// =====================================
// تعبئة صفوف سجل الغياب والمغادرات
// =====================================

function populateFilterGradeOptions() {
  if (!filterGrade) return;

  const selectedValue = filterGrade.value;

  filterGrade.innerHTML =
    '<option value="">جميع الصفوف والشعب</option>';

  getGrades().forEach(grade => {
    const option = document.createElement("option");
    option.value = grade;
    option.textContent = grade;
    filterGrade.appendChild(option);
  });

  if (getGrades().includes(selectedValue)) {
    filterGrade.value = selectedValue;
  }
}

function getStudentsInSelectedGrade() {
  if (!gradeSelect || !gradeSelect.value) return [];

  return allStudents.filter(student =>
    String(student.grade).trim() === gradeSelect.value
  );
}


function updateStudentOptions() {
  if (!studentSelect || !gradeSelect) {
    renderStudentSelectionList();
    return;
  }

  const previousStudentId = studentSelect.value;

  studentSelect.innerHTML =
    '<option value="">اختر الطالب</option>';

  const students = getStudentsInSelectedGrade();

  students.forEach(student => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = student.name;
    studentSelect.appendChild(option);
  });

  studentSelect.disabled = students.length === 0;

  if (students.some(student => student.id === previousStudentId)) {
    studentSelect.value = previousStudentId;
  }

  if (!gradeSelect.value) {
    studentSelect.innerHTML =
      '<option value="">اختر الصف والشعبة أولًا</option>';
    studentSelect.disabled = true;
    studentSelect.value = "";
  } else if (students.length === 0) {
    studentSelect.innerHTML =
      '<option value="">لا يوجد طلاب في هذا الصف</option>';
    studentSelect.value = "";
  }

  renderStudentSelectionList();
  renderStudentStatus();
}

// =====================================
// معلومات السجلات
// =====================================

function getRecordGrade(record) {
  return record.grade || record.className || record.class || "";
}

function getRecordStudentName(record) {
  return (
    record.studentName ||
    record.name ||
    record.student ||
    "—"
  );
}

function getRecordDate(record) {
  return record.date || "";
}

function sameStudent(record, student) {
  if (record.studentId && student.id) {
    return record.studentId === student.id;
  }

  return (
    getRecordStudentName(record) === student.name &&
    getRecordGrade(record) === student.grade
  );
}

function getRecordStatusForStudent(student, date, lesson) {
  const matchingRecords = allRecords.filter(record =>
    sameStudent(record, student) &&
    getRecordDate(record) === date
  );

  const departure = matchingRecords.find(
    record => record.type === "departure"
  );

  if (departure) {
    return {
      text: "مغادرة",
      css: "status-departure",
      record: departure
    };
  }


  const absence = matchingRecords.find(
    record => record.type === "absence"
  );

  if (absence) {
    return {
      text: "غائبة",
      css: "status-absence",
      record: absence
    };
  }

  return {
    text: "لم يسجل الغياب",
    css: "status-pending",
    record: null
  };
}


function renderStudentSelectionList() {
  if (!studentStatusList) return;

  studentStatusList.innerHTML = "";

  const students = getStudentsInSelectedGrade();
  const date = attendanceDate?.value || "";
  const lesson = lessonSelect?.value || "";
  const selectedId = studentSelect?.value || "";

  if (!gradeSelect?.value) {
    studentStatusList.innerHTML =
      '<div class="student-status-empty">اختر الصف والشعبة أولًا.</div>';
    return;
  }

  if (students.length === 0) {
    studentStatusList.innerHTML =
      '<div class="student-status-empty">لا يوجد طلاب في هذا الصف.</div>';
    return;
  }

  students.forEach(student => {
    let status = {
      text: "اختر التاريخ لعرض الحالة",
      css: "status-pending",
      record: null
    };

    if (date) {
      status = getRecordStatusForStudent(
        student,
        date,
        lesson
      );
    }

    const isAbsent = status.text === "غائبة";
    const isDeparted = status.text === "مغادرة";

    const button = document.createElement("button");
    button.type = "button";

    button.className = [
      "student-status-item",
      isAbsent ? "is-absent" : "",
      isDeparted ? "is-departed" : "",
      selectedId === student.id ? "selected" : ""
    ].filter(Boolean).join(" ");

    button.setAttribute(
      "aria-pressed",
      String(selectedId === student.id)
    );

    const name = document.createElement("span");
    name.className = "student-name";
    name.textContent = student.name;

    const label = document.createElement("span");
    label.className =
      `student-status-label ${status.css}`;
    label.textContent = status.text;

    button.append(name, label);

    button.addEventListener("click", () => {
      if (!studentSelect) return;

      studentSelect.value = student.id;

      renderStudentSelectionList();
      renderStudentStatus();
      clearMessage();
    });

    studentStatusList.appendChild(button);
  });
}


function renderStudents() {
  if (!studentsBody) return;

  const grade = statusGradeFilter?.value || "";
  const selectedLesson = statusLessonFilter?.value || "";
  const date = attendanceDate?.value || "";

  studentsBody.innerHTML = "";

  if (!grade || !selectedLesson || !date) {
    studentsBody.innerHTML = `
      <tr>
        <td colspan="6">اختر الصف والحصة لعرض حالة الطلاب.</td>
      </tr>
    `;
    return;
  }

  const lessonNames = {
    "1": "الحصة الأولى",
    "2": "الحصة الثانية",
    "3": "الحصة الثالثة",
    "4": "الحصة الرابعة",
    "5": "الحصة الخامسة",
    "6": "الحصة السادسة",
    "7": "الحصة السابعة",
    "8": "الحصة الثامنة"
  };

  const lesson = lessonNames[selectedLesson] || selectedLesson;

  const students = allStudents.filter(student =>
    String(student.grade).trim() === grade
  );

  if (students.length === 0) {
    studentsBody.innerHTML = `
      <tr>
        <td colspan="6">لا يوجد طلاب مسجلات في الصف المحدد.</td>
      </tr>
    `;
    return;
  }

  students.forEach(student => {
    // الحالة تُعرض من سجل اليوم كاملًا حتى لو تغيرت الحصة.
    const status = getRecordStatusForStudent(
      student,
      date,
      lesson
    );

    const record = status.record;
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHTML(student.name)}</td>
      <td>${escapeHTML(student.grade)}</td>
      <td>${escapeHTML(lesson)}</td>
      <td>
        <span class="attendance-status ${status.css}">
          ${escapeHTML(status.text)}
        </span>
      </td>
      <td>${escapeHTML(record?.teacher || "—")}</td>
      <td>${escapeHTML(record ? getRecordTime(record) : "—")}</td>
    `;

    studentsBody.appendChild(row);
  });
}

// =====================================
// معاينة حالة الطالب المختارة
// =====================================

function renderStudentStatus() {
  if (!studentStatusPreview || !studentSelect) return;

  const studentId = studentSelect.value;

  if (!studentId) {
    studentStatusPreview.textContent =
      "اختر طالب لعرض الحالة.";
    return;
  }

  const student = allStudents.find(item =>
    item.id === studentId
  );

  if (!student) {
    studentStatusPreview.textContent =
      "لم يتم العثور على بيانات الطالب.";
    return;
  }

  const date = attendanceDate?.value || "";
  const lesson = lessonSelect?.value || "";

  if (!date) {
    studentStatusPreview.textContent =
      "اختر التاريخ لعرض الحالة.";
    return;
  }

  const status = getRecordStatusForStudent(
    student,
    date,
    lesson
  );

  studentStatusPreview.textContent = status.text;
}

// =====================================
// تسجيل الغياب
// =====================================

async function saveAttendance() {
  if (isSaving) return;

  const grade = gradeSelect?.value || "";
  const lesson = lessonSelect?.value || "";
  const date = attendanceDate?.value || "";
  const studentId = studentSelect?.value || "";
  const teacher = teacherName?.value.trim() || "";

  if (!grade) {
    showMessage("يرجى اختيار الصف والشعبة.", "error");
    return;
  }

  if (!lesson) {
    showMessage("يرجى اختيار الحصة.", "error");
    return;
  }

  if (!date) {
    showMessage("يرجى تحديد التاريخ.", "error");
    return;
  }

  if (!studentId) {
    showMessage("يرجى اختيار الطالب.", "error");
    return;
  }

  if (!teacher) {
    showMessage("يرجى كتابة اسم المعلم.", "error");
    teacherName?.focus();
    return;
  }

  const student = allStudents.find(item =>
    item.id === studentId
  );

  if (!student || String(student.grade).trim() !== grade) {
    showMessage(
      "تعذر العثور على الطالب ضمن الصف المحدد.",
      "error"
    );
    return;
  }

  // يمنع تسجيل الحالة مرة أخرى إذا كان لها سجل
  // غياب أو مغادرة في أي حصة من اليوم نفسه.
  const status = getRecordStatusForStudent(
    student,
    date,
    lesson
  );

  if (status.text === "مغادرة") {
    showMessage(
      "يوجد سجل مغادرة لهذه الطالب في التاريخ المحدد.",
      "error"
    );
    return;
  }

  if (status.text === "غائبة") {
    showMessage(
      "تم تسجيل غياب هذه الطالب في هذا اليوم مسبقًا.",
      "error"
    );
    return;
  }

  isSaving = true;

  if (saveAttendanceBtn) {
    saveAttendanceBtn.disabled = true;
  }

  try {
    localStorage.setItem(
      "attendanceTeacherName",
      teacher
    );

    const recordsRef = collection(
      db,
      "schools",
      currentSchoolId,
      "records"
    );

    await addDoc(recordsRef, {
      type: "absence",
      studentId: student.id,
      studentName: student.name,
      grade: student.grade,
      lesson,
      date,
      time: getLocalTime(),
      teacher,
      academicYear: currentAcademicYear,
      createdAt: serverTimestamp()
    });

    await loadRecords();

    renderStudentSelectionList();
    renderStudents();
    renderStudentStatus();
    renderRecords();

    showMessage(
      `تم تسجيل غياب الطالب ${student.name} بنجاح، وستظهر غائبة في جميع حصص اليوم.`,
      "success"
    );
  } catch (error) {
    console.error("Attendance save error:", error);

    showMessage(
      "تعذر حفظ الغياب. تحققي من الاتصال بالإنترنت وصلاحيات Firebase.",
      "error"
    );
  } finally {
    isSaving = false;

    if (saveAttendanceBtn) {
      saveAttendanceBtn.disabled = false;
    }
  }
}

// =====================================
// سجل الغياب والمغادرات
// =====================================

function renderRecords() {
  if (!absenceRecordsBody) return;

  const grade = filterGrade?.value || "";
  const lesson = filterLesson?.value || "";
  const date = filterDate?.value || "";
  const status = filterStatus?.value || "";

  const teacherQuery = (filterTeacher?.value || "")
    .trim()
    .toLocaleLowerCase("ar");

  const studentQuery = (filterStudent?.value || "")
    .trim()
    .toLocaleLowerCase("ar");

  const filteredRecords = allRecords
    .filter(record => {
      if (grade && getRecordGrade(record) !== grade) {
        return false;
      }

      if (lesson && record.lesson !== lesson) {
        return false;
      }

      if (date && getRecordDate(record) !== date) {
        return false;
      }

      if (status && record.type !== status) {
        return false;
      }

      const teacher = String(record.teacher || "")
        .toLocaleLowerCase("ar");

      if (teacherQuery && !teacher.includes(teacherQuery)) {
        return false;
      }

      const studentName = getRecordStudentName(record)
        .toLocaleLowerCase("ar");

      if (studentQuery && !studentName.includes(studentQuery)) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const dateCompare = getRecordDate(b).localeCompare(
        getRecordDate(a)
      );

      if (dateCompare !== 0) return dateCompare;

      return getRecordTime(b).localeCompare(getRecordTime(a));
    });

  absenceRecordsBody.innerHTML = "";

  if (filteredRecords.length === 0) {
    absenceRecordsBody.innerHTML = `
      <tr>
        <td colspan="7">لا توجد سجلات مطابقة لخيارات التصفية.</td>
      </tr>
    `;
  } else {
    filteredRecords.forEach(record => {
      const isDeparture = record.type === "departure";

      const statusText = isDeparture ? "مغادرة" : "غائبة";
      const statusClass = isDeparture
        ? "status-departure"
        : "status-absence";

      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${escapeHTML(getRecordStudentName(record))}</td>
        <td>${escapeHTML(getRecordGrade(record) || "—")}</td>
        <td>${escapeHTML(record.lesson || "—")}</td>
        <td>
          <span class="attendance-status ${statusClass}">
            ${statusText}
          </span>
        </td>
        <td>${escapeHTML(record.teacher || "—")}</td>
        <td>${escapeHTML(formatDate(getRecordDate(record)))}</td>
        <td>${escapeHTML(getRecordTime(record))}</td>
      `;

      absenceRecordsBody.appendChild(row);
    });
  }

  if (recordsCount) {
    recordsCount.textContent = String(filteredRecords.length);
  }
}

// =====================================
// تحديث البيانات
// =====================================

async function refreshData() {
  if (isLoading || !currentSchoolId) return;

  isLoading = true;

  if (refreshListBtn) {
    refreshListBtn.disabled = true;
  }

  try {
    await loadStudents();
    await loadRecords();

    populateGradeOptions();
    populateStatusGradeOptions();
    populateFilterGradeOptions();

    renderStudentSelectionList();
    renderStudents();
    renderStudentStatus();
    renderRecords();

    showMessage(
      `تم تحديث البيانات. عدد الطلاب: ${allStudents.length}.`,
      "success"
    );
  } catch (error) {
    console.error("Refresh error:", error);

    showMessage(
      "تعذر تحديث البيانات. تحققي من الاتصال وصلاحيات قاعدة البيانات.",
      "error"
    );
  } finally {
    isLoading = false;

    if (refreshListBtn) {
      refreshListBtn.disabled = false;
    }
  }
}

// =====================================
// مسح التصفية
// =====================================

function clearFilters() {
  [
    filterGrade,
    filterLesson,
    filterDate,
    filterStatus,
    filterTeacher,
    filterStudent
  ].forEach(element => {
    if (element) element.value = "";
  });

  renderRecords();
}

// =====================================
// تهيئة الصفحة وربط الأحداث
// =====================================

function initializePage() {
  const today = getLocalDate();

  if (attendanceDate) {
    attendanceDate.value = today;
  }

  if (todayDate) {
    todayDate.textContent = formatDate(today);
  }

  if (filterDate) {
    filterDate.value = "";
  }

  gradeSelect?.addEventListener("change", () => {
    updateStudentOptions();
    renderStudentSelectionList();
    renderStudents();
  });

  lessonSelect?.addEventListener("change", () => {
    renderStudentSelectionList();
    renderStudents();
    renderStudentStatus();
  });

  attendanceDate?.addEventListener("change", () => {
    renderStudentSelectionList();
    renderStudents();
    renderStudentStatus();
  });

  studentSelect?.addEventListener("change", () => {
    renderStudentSelectionList();
    renderStudentStatus();
  });

  teacherName?.addEventListener("change", () => {
    localStorage.setItem(
      "attendanceTeacherName",
      teacherName.value.trim()
    );
  });

  saveAttendanceBtn?.addEventListener(
    "click",
    saveAttendance
  );

  refreshListBtn?.addEventListener(
    "click",
    refreshData
  );

  statusGradeFilter?.addEventListener(
    "change",
    renderStudents
  );

  statusLessonFilter?.addEventListener(
    "change",
    renderStudents
  );

  applyFiltersBtn?.addEventListener(
    "click",
    renderRecords
  );

  clearFiltersBtn?.addEventListener(
    "click",
    clearFilters
  );

  [
    filterGrade,
    filterLesson,
    filterDate,
    filterStatus
  ].forEach(element => {
    element?.addEventListener(
      "change",
      renderRecords
    );
  });

  filterTeacher?.addEventListener(
    "input",
    renderRecords
  );

  filterStudent?.addEventListener(
    "input",
    renderRecords
  );

  const logoutBtn = $("logoutBtn");

  logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "login.html";
    } catch (error) {
      console.error("Logout error:", error);
      showMessage("تعذر تسجيل الخروج.", "error");
    }
  });
}

// =====================================
// بدء تشغيل الصفحة
// =====================================

initializePage();

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  showMessage(
    "جارٍ تحميل بيانات المدرسة الطلاب...",
    "info"
  );

  try {
    await loadSchool(user);
  } catch (error) {
    console.error("Page initialization error:", error);

    showMessage(
      error.message || "تعذر تحميل بيانات الصفحة.",
      "error"
    );
  }
});
