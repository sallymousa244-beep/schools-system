import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const DEFAULT_YEAR = "2026 / 2027";

let currentSchoolId = null;
let currentAcademicYear = DEFAULT_YEAR;
let students = [];

// تنظيف النصوص وتوحيد المسافات
function cleanText(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s+/g, " ");
}

// توحيد تنسيق العام الدراسي للمقارنة
function normalizeAcademicYear(value) {
  return cleanText(value).replace(/\s*\/\s*/g, " / ");
}

function studentYear(student) {
  return normalizeAcademicYear(
    student.academicYear || DEFAULT_YEAR
  );
}

// عرض الرسائل
function showMessage(message, type = "info") {
  const element = $("lateMessage");

  if (!element) return;

  element.textContent = message;

  element.style.color =
    type === "error" ? "#b42318" :
    type === "success" ? "#16835d" :
    "#526b91";
}

// تعبئة قائمة الصفوف والشعب
function loadGrades() {
  const gradeSelect = $("lateGrade");
  const studentSelect = $("lateStudentName");

  if (!gradeSelect || !studentSelect) {
    console.error(
      "لم يتم العثور على lateGrade أو lateStudentName. تحققي من معرفات العناصر في late.html."
    );
    return;
  }

  const grades = [
    ...new Set(
      students
        .filter(
          (student) =>
            cleanText(student.name) &&
            cleanText(student.grade) &&
            student.isActive !== false &&
            studentYear(student) ===
              normalizeAcademicYear(currentAcademicYear)
        )
        .map((student) => cleanText(student.grade))
    )
  ].sort((a, b) => a.localeCompare(b, "ar"));

  // إعادة بناء قائمة الصفوف
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

  console.log("العام الدراسي:", currentAcademicYear);
  console.log("عدد الطلاب:", students.length);
  console.log("الصفوف المتاحة:", grades);

  if (grades.length === 0) {
    showMessage(
      "لم يتم العثور على صفوف للعام الدراسي المحدد. تحقق من بيانات الطلاب والعام الدراسي.",
      "error"
    );
  } else {
    showMessage("تم تحميل الصفوف بنجاح.", "success");
  }
}

function loadStudentNames() {
  const gradeSelect = $("lateGrade");
  const studentSelect = $("lateStudentName");

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

  const matchingStudents = students
    .filter(
      (student) =>
        cleanText(student.name) &&
        cleanText(student.grade) === selectedGrade &&
        studentYear(student) ===
          normalizeAcademicYear(currentAcademicYear) &&
        student.isActive !== false
    )
    .sort((a, b) =>
      cleanText(a.name).localeCompare(
        cleanText(b.name),
        "ar"
      )
    );

  placeholder.textContent = matchingStudents.length
    ? "يرجى اختيار اسم الطالب"
    : "لا يوجد طلاب في هذا الصف";

  studentSelect.appendChild(placeholder);

  matchingStudents.forEach((student) => {
    const option = document.createElement("option");

    option.value = student.id;
    option.textContent = cleanText(student.name);

    studentSelect.appendChild(option);
  });

  studentSelect.disabled = matchingStudents.length === 0;

  if (matchingStudents.length === 0) {
    showMessage(
      "لا يوجد طلاب نشطات في الصف المختار للعام الدراسي الحالي.",
      "error"
    );
  } else {
    showMessage(
      `تم تحميل ${matchingStudents.length} طالب في الصف المختار.`,
      "success"
    );
  }
}

$("lateGrade")?.addEventListener("change", loadStudentNames);

// تحديث التاريخ والوقت الحاليين
function updateDateTime() {
  const dateElement = $("lateDate");
  const timeElement = $("lateTime");

  if (!dateElement || !timeElement) return;

  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  dateElement.value = `${year}-${month}-${day}`;

  timeElement.value =
    `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
}

updateDateTime();

// تسجيل التأخير وحفظه في Firebase
$("lateForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentSchoolId) {
    showMessage("لم يتم تحديد المدرسة.", "error");
    return;
  }

  const grade = cleanText($("lateGrade")?.value);
  const studentId = $("lateStudentName")?.value;

  const student = students.find(
    (item) => item.id === studentId
  );

  const reason = $("lateReason")?.value;
  const notes = $("lateNotes")?.value?.trim() || "";

  if (
    !grade ||
    !student ||
    cleanText(student.grade) !== grade ||
    studentYear(student) !==
      normalizeAcademicYear(currentAcademicYear) ||
    student.isActive === false
  ) {
    showMessage("يرجى اختيار الصف واسم طالب بشكل صحيح.", "error");
    return;
  }

  const saveButton = $("saveLateBtn");

  if (saveButton) saveButton.disabled = true;

  try {
    await addDoc(
      collection(db, "schools", currentSchoolId, "records"),
      {
        type: "late",
        studentId: student.id,
        studentName: cleanText(student.name),
        grade: cleanText(student.grade),
        date: $("lateDate")?.value || "",
        time: $("lateTime")?.value || "",
        reason: reason || "",
        notes,
        academicYear: currentAcademicYear,
        createdAt: serverTimestamp()
      }
    );

    showMessage("تم حفظ سجل التأخير بنجاح.", "success");

    $("lateForm")?.reset();

    const studentSelect = $("lateStudentName");

    if (studentSelect) {
      studentSelect.replaceChildren(
        new Option("يرجى اختيار الصف أولًا", "")
      );

      studentSelect.disabled = true;
    }

    updateDateTime();

  } catch (error) {
    console.error("خطأ في حفظ التأخير:", error);

    showMessage(
      `تعذر الحفظ: ${error.code || ""} - ${
        error.message || "خطأ غير معروف"
      }`,
      "error"
    );
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
});

// تسجيل الخروج
$("logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "index.html";
  } catch (error) {
    console.error("خطأ في تسجيل الخروج:", error);
    showMessage("تعذر تسجيل الخروج.", "error");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    currentSchoolId = user.uid;

    // تحميل بيانات المدرسة
    const schoolSnapshot = await getDoc(
      doc(db, "schools", currentSchoolId)
    );

    if (
      !schoolSnapshot.exists() ||
      schoolSnapshot.data().ownerUid !== user.uid
    ) {
      showMessage(
        "لا توجد صلاحية للوصول إلى بيانات المدرسة.",
        "error"
      );

      await signOut(auth);
      window.location.href = "index.html";

      return;
    }

    const schoolData = schoolSnapshot.data();

    currentAcademicYear = normalizeAcademicYear(
      schoolData.currentAcademicYear || DEFAULT_YEAR
    );

    const schoolNameElement = $("sidebarSchoolName");

    if (schoolNameElement) {
      schoolNameElement.textContent =
        schoolData.schoolName || "المدرسة";
    }

    const studentsRef = collection(
      db,
      "schools",
      currentSchoolId,
      "students"
    );

    const snapshot = await getDocs(studentsRef);

    const allStudentRecords = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    console.log(
      "إجمالي سجلات الطلاب في Firebase:",
      allStudentRecords.length
    );

    console.log(
      "العام الدراسي الحالي في المدرسة:",
      currentAcademicYear
    );

    students = allStudentRecords.filter(
      (student) =>
        cleanText(student.name) &&
        cleanText(student.grade) &&
        studentYear(student) ===
          normalizeAcademicYear(currentAcademicYear) &&
        student.isActive !== false
    );

    console.log(
      "عدد الطلاب المطابق للعام الدراسي:",
      students.length
    );

    console.log(
      "الصفوف الموجودة في جميع السجلات:",
      [
        ...new Set(
          allStudentRecords
            .map((student) => cleanText(student.grade))
            .filter(Boolean)
        )
      ]
    );

    // تعبئة الصفوف بعد اكتمال تحميل البيانات
    loadGrades();

  } catch (error) {
    console.error(
      "خطأ في تحميل بيانات صفحة التأخير:",
      error
    );

    showMessage(
      `تعذر تحميل البيانات: ${error.code || ""} - ${
        error.message || "خطأ غير معروف"
      }`,
      "error"
    );
  }
});
