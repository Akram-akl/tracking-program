// --- Constants ---
const LEVELS = {
    'secondary': { name: 'المرحلة الثانوية', emoji: '🏢', teacherPass: '1001', studentPass: '10010' },
    'middle': { name: 'المرحلة المتوسطة', emoji: '🏫', teacherPass: '2002', studentPass: '20020' },
    'upper_elem': { name: 'الابتدائية العليا', emoji: '🎒', teacherPass: '3003', studentPass: '30030' },
    'lower_elem': { name: 'الابتدائية الأولية', emoji: '🧸', teacherPass: '4004', studentPass: '40040' }
};

const MASTER_TEACHER_PASS = "123456"; // Can access selector

// --- State Management ---
const state = {
    isTeacher: false,
    isParent: false,          // NEW: Parent role
    parentPhone: null,        // NEW: Parent's phone for lookup
    parentStudents: [],       // NEW: Students found for parent
    currentLevel: null, // Null indicates not logged in
    currentView: 'home',
    students: [],
    competitions: [],
    groups: [],
    scores: [],
    darkMode: localStorage.getItem('darkMode') === 'true',
    studentPassword: null // For student mode authentication persistence
};

// --- Firestore Listeners ---
let studentsUnsubscribe = null;
let competitionsUnsubscribe = null;
let activeGroupsUnsubscribe = null;
let scoresUnsubscribe = null;
let homeStudentsUnsubscribe = null;
let homeGroupsUnsubscribe = null;

// --- Global Error Handler for Debugging ---
window.onerror = function (msg, url, line, col, error) {
    var errorDiv = document.getElementById('error-display');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'error-display';
        errorDiv.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:red;color:white;padding:10px;font-size:10px;z-index:9999;max-height:100px;overflow:auto;';
        document.body.appendChild(errorDiv);
    }
    errorDiv.innerHTML += '<div>Error: ' + msg + ' at ' + line + ':' + col + '</div>';
    return false;
};

// --- Helpers ---
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// --- Toast Notification ---
function showToast(msg, type = 'success') {
    const toast = $('#toast');
    const toastMsg = $('#toast-msg');
    if (!toast) return;

    // Reset classes - MAXIMUM Z-INDEX to ensure visibility over everything (including modals)
    toast.className = 'fixed top-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-lg z-[9999] transition-all duration-300 flex items-center gap-3 min-w-[200px] justify-center text-white';

    if (type === 'error') toast.classList.add('bg-red-600');
    else if (type === 'success') toast.classList.add('bg-green-600');
    else toast.classList.add('bg-gray-800');

    toastMsg.textContent = msg;
    toast.classList.remove('hidden', 'opacity-0', 'translate-y-[-20px]');

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-[-20px]');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

function toggleModal(id, show = true) {
    const modal = $(`#${id}`);
    if (!modal) return;
    if (show) modal.classList.remove('hidden');
    else modal.classList.add('hidden');
}
window.closeModal = (id) => toggleModal(id, false);

// --- Image Compression Utility ---
async function compressImage(file, maxWidth = 300, maxHeight = 300, quality = 0.7) {
    if (!file) return null;
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
        };
    });
}

// --- Authentication & Persistence ---

function loadAuth() {
    const savedLevel = localStorage.getItem('auth_level');
    const savedRole = localStorage.getItem('auth_role');
    const savedParentPhone = localStorage.getItem('auth_parent_phone');

    // Parent login
    if (savedRole === 'parent' && savedParentPhone) {
        state.isParent = true;
        state.parentPhone = savedParentPhone;
        return true;
    }

    if (savedLevel && LEVELS[savedLevel]) {
        state.currentLevel = savedLevel;
        state.isTeacher = savedRole === 'teacher';
        return true; // Logged in
    }
    return false; // Not logged in
}

function saveAuth() {
    if (state.isParent && state.parentPhone) {
        localStorage.setItem('auth_role', 'parent');
        localStorage.setItem('auth_parent_phone', state.parentPhone);
    } else if (state.currentLevel) {
        localStorage.setItem('auth_level', state.currentLevel);
        localStorage.setItem('auth_role', state.isTeacher ? 'teacher' : 'student');
    }
}

function logout() {
    // 1. Unsubscribe from all active listeners
    if (studentsUnsubscribe) { studentsUnsubscribe(); studentsUnsubscribe = null; }
    if (competitionsUnsubscribe) { competitionsUnsubscribe(); competitionsUnsubscribe = null; }
    if (activeGroupsUnsubscribe) { activeGroupsUnsubscribe(); activeGroupsUnsubscribe = null; }
    if (scoresUnsubscribe) { scoresUnsubscribe(); scoresUnsubscribe = null; }
    if (homeStudentsUnsubscribe) { homeStudentsUnsubscribe(); homeStudentsUnsubscribe = null; }
    if (homeGroupsUnsubscribe) { homeGroupsUnsubscribe(); homeGroupsUnsubscribe = null; }

    state.isTeacher = false;
    state.isParent = false;
    state.parentPhone = null;
    state.parentStudents = [];
    state.currentLevel = null;
    state.students = [];
    state.competitions = [];
    state.scores = [];

    localStorage.removeItem('auth_level');
    localStorage.removeItem('auth_role');
    localStorage.removeItem('auth_parent_phone');

    // Show Auth Modal
    showAuthModal();
}

function showAuthModal() {
    // Hide App Content
    $('#app-content-wrapper').classList.add('hidden'); // We will wrap content in index.html
    $('#auth-overlay').classList.remove('hidden');
}

function handleLogin(type) {
    // type: 'student' | 'teacher' | 'parent'
    // Hide ALL panels first to support switching between them
    $('#auth-options-panel').classList.add('hidden');
    $('#student-login-panel').classList.add('hidden');
    $('#teacher-login-panel').classList.add('hidden');
    $('#parent-login-panel').classList.add('hidden');

    if (type === 'student') {
        $('#student-login-panel').classList.remove('hidden');
    } else if (type === 'parent') {
        $('#parent-login-panel').classList.remove('hidden');
    } else {
        $('#teacher-login-panel').classList.remove('hidden');
    }
}

function backToAuthHome() {
    $('#student-login-panel').classList.add('hidden');
    $('#teacher-login-panel').classList.add('hidden');
    $('#parent-login-panel').classList.add('hidden');
    $('#auth-options-panel').classList.remove('hidden');
}

function performStudentLogin() {
    const levelKey = $('#student-level-select').value;
    const password = $('#student-password-input').value;

    if (!levelKey || !LEVELS[levelKey]) {
        showToast("الرجاء اختيار المرحلة", "error");
        return;
    }

    // Check Global Password for the SPECIFIC selected level only
    const correctPass = LEVELS[levelKey].studentPass;

    if (password === correctPass) {
        state.currentLevel = levelKey;
        state.isTeacher = false;
        state.studentPassword = password; // Store for permission checks
        completeLogin();
    } else {
        // Also check if it's an individual student password (optional feature mentioned in code comments)
        // If we want to allow individual student passwords, we'd need to fetch students first.
        // For now, based on user request "Strict Level Password", we enforce the global level password.
        showToast("كلمة المرور غير صحيحة لهذه المرحلة", "error");
    }
}

function performTeacherLogin() {
    const password = $('#teacher-password-input').value;
    const selectedLevel = $('#teacher-level-select').value;

    // 1. Master Password Logic (Universal Access)
    if (password === MASTER_TEACHER_PASS) {
        if (selectedLevel) {
            // Level selected -> Log in directly
            finishTeacherLogin(selectedLevel);
        } else {
            // No level selected -> Show Level Selector Grid (Legacy/Admin Node)
            $('#teacher-password-section').classList.add('hidden');
            $('#teacher-level-selection').classList.remove('hidden');
            const container = $('#teacher-level-grid');
            container.innerHTML = Object.entries(LEVELS).map(([key, config]) => `
                 <button onclick="finishTeacherLogin('${key}')" class="p-4 bg-teal-50 dark:bg-gray-700 rounded-xl border border-teal-100 dark:border-gray-600 hover:border-teal-500 transition text-center">
                    <div class="text-2xl mb-2">${config.emoji}</div>
                    <div class="text-sm font-bold text-gray-800 dark:text-gray-100">${config.name}</div>
                 </button>
            `).join('');
        }
        return;
    }

    // 2. Strict Level Logic
    if (!selectedLevel) {
        showToast("الرجاء اختيار المرحلة أولاً", "error");
        return;
    }

    // Check if password matches ONLY the selected level
    const config = LEVELS[selectedLevel];
    if (config && password === config.teacherPass) {
        finishTeacherLogin(selectedLevel);
    } else {
        showToast("كلمة المرور غير صحيحة للمرحلة المختارة", "error");
    }
}

function finishTeacherLogin(levelKey) {
    state.currentLevel = levelKey;
    state.isTeacher = true;
    completeLogin();
}

// --- Password Visibility Toggle ---
function toggleLoginPasswords(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Toggle visibility
    if (el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        populatePasswordList(elementId);
    } else {
        el.classList.add('hidden');
    }
}

function populatePasswordList(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let html = '';

    if (elementId === 'teacher-pass-list') {
        html += `<div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-600 pb-1 mb-1">
                    <span class="font-bold text-purple-600">الماستر (الشامل)</span>
                    <span class="font-mono bg-purple-100 dark:bg-purple-900 px-2 rounded">${MASTER_TEACHER_PASS}</span>
                 </div>`;

        Object.entries(LEVELS).forEach(([key, conf]) => {
            html += `<div class="flex justify-between items-center">
                        <span>${conf.name} ${conf.emoji}</span>
                        <span class="font-mono bg-gray-100 dark:bg-gray-700 px-2 rounded text-gray-600 dark:text-gray-300">${conf.teacherPass}</span>
                     </div>`;
        });
    }
    else if (elementId === 'student-pass-list') {
        Object.entries(LEVELS).forEach(([key, conf]) => {
            html += `<div class="flex justify-between items-center">
                        <span>${conf.name} ${conf.emoji}</span>
                        <span class="font-mono bg-gray-100 dark:bg-gray-700 px-2 rounded text-gray-600 dark:text-gray-300">${conf.studentPass}</span>
                     </div>`;
        });
    }

    el.innerHTML = html;
}

// --- Parent Login ---
function normalizePhone(phone) {
    if (!phone) return '';
    // Remove all non-digits
    let cleaned = phone.replace(/[^0-9]/g, '');
    // Saudi format: 05xxxxxxxx -> 966xxxxxxxx
    if (cleaned.startsWith('05') && cleaned.length === 10) {
        cleaned = '966' + cleaned.substring(1);
    } else if (cleaned.startsWith('5') && cleaned.length === 9) {
        cleaned = '966' + cleaned;
    }
    // For international numbers, keep as-is
    return cleaned;
}

async function performParentLogin() {
    const phoneInput = $('#parent-phone-input').value.trim();
    const phone = normalizePhone(phoneInput);

    if (!phone || phone.length < 9) {
        showToast("الرجاء إدخال رقم جوال صحيح", "error");
        return;
    }

    showToast("جاري البحث عن الطلاب...");

    try {
        // Search across ALL levels for students with this parentPhone
        const q = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "students"),
            window.firebaseOps.where("parentPhone", "==", phone)
        );

        const snap = await window.firebaseOps.getDocs(q);

        if (snap.empty) {
            showToast("لا يوجد طلاب مسجلين بهذا الرقم", "error");
            return;
        }

        // Found students
        state.parentStudents = [];
        snap.forEach(doc => {
            var dData = doc.data();
            dData.id = doc.id;
            state.parentStudents.push(dData);
        });

        state.isParent = true;
        state.parentPhone = phone;
        completeParentLogin();

    } catch (e) {
        console.error(e);
        showToast("خطأ في البحث", "error");
    }
}

function completeParentLogin() {
    saveAuth();
    $('#auth-overlay').classList.add('hidden');
    $('#app-content-wrapper').classList.remove('hidden');
    $('#loading').classList.add('hidden');
    $('#view-container').classList.remove('hidden');

    updateUIMode();

    // Start Global Sync (optional for parent, but good for shared level data if any)
    startGlobalDataSync();

    router.navigate('parent'); // NEW route for parent dashboard

    showToast(`مرحباً بك! تم العثور على ${state.parentStudents.length} طالب/طالبة`);
}

function completeLogin() {
    saveAuth();
    $('#auth-overlay').classList.add('hidden');
    $('#app-content-wrapper').classList.remove('hidden');

    // Update UI headers
    updateUIMode();

    // Start Global Sync
    startGlobalDataSync();

    // Load Data
    router.navigate('home');

    showToast(`مرحباً بك في ${LEVELS[state.currentLevel].name}`);

    // Explicitly show content
    $('#loading').classList.add('hidden');
    $('#view-container').classList.remove('hidden');
}

function updateUIMode() {
    const btn = $('#mode-btn'); // This is now logout button or status
    const label = $('#current-mode-label');
    const badge = $('#level-badge');
    const header = $('header');
    const nav = $('nav');

    // Hide header/nav for parent mode
    if (state.isParent) {
        if (header) header.classList.add('hidden');
        if (nav) nav.classList.add('hidden');
        return; // Parent has its own UI
    } else {
        if (header) header.classList.remove('hidden');
        if (nav) nav.classList.remove('hidden');
    }

    const levelName = (LEVELS[state.currentLevel] ? LEVELS[state.currentLevel].name : '...');

    if (badge) {
        badge.textContent = levelName;
        badge.classList.remove('hidden');
    }

    if (state.isTeacher) {
        label.textContent = `${levelName} - معلم`;
        label.className = "text-xs text-yellow-300 font-bold";
        btn.innerHTML = '<i data-lucide="log-out" class="w-5 h-5"></i>';
        btn.onclick = logout; // Bind logout
        btn.className = "p-2 bg-red-800/80 rounded-full hover:bg-red-600 transition text-white border border-red-500/50";
    } else {
        label.textContent = `${levelName} - طالب`;
        label.className = "text-xs text-teal-200 mt-0.5";
        btn.innerHTML = '<i data-lucide="log-out" class="w-5 h-5"></i>'; // Also logout for student to switch level
        btn.onclick = logout;
        btn.className = "p-2 bg-teal-800/80 rounded-full hover:bg-teal-600 transition text-white border border-teal-500/50";
    }

    refreshAllData();
}

function refreshAllData() {
    if (state.currentView === 'home') renderHome();
    if (state.currentView === 'competitions') renderCompetitions();
    if (state.currentView === 'students') renderStudents();
}

// --- Router ---
const router = {
    routes: {
        home: renderHome,
        competitions: renderCompetitions,
        students: renderStudents,
        settings: renderSettings,
        parent: renderParentDashboard  // NEW: Parent Portal
    },
    cleanup() {
        // Unsubscribe from all active listeners to prevent memory leaks/lag
        if (studentsUnsubscribe) { studentsUnsubscribe(); studentsUnsubscribe = null; }
        if (competitionsUnsubscribe) { competitionsUnsubscribe(); competitionsUnsubscribe = null; }
        if (activeGroupsUnsubscribe) { activeGroupsUnsubscribe(); activeGroupsUnsubscribe = null; }
        if (scoresUnsubscribe) { scoresUnsubscribe(); scoresUnsubscribe = null; }
        if (homeStudentsUnsubscribe) { homeStudentsUnsubscribe(); homeStudentsUnsubscribe = null; }
        if (homeGroupsUnsubscribe) { homeGroupsUnsubscribe(); homeGroupsUnsubscribe = null; }
    },
    // History-aware navigation
    navigate(view) {
        if (state.currentView === view) return;
        // Push to history
        history.pushState({ view: view }, '', `#${view}`);
        this.render(view);
    },

    // Render the view (internal)
    render(view) {
        // Cleanup previous view's listeners
        this.cleanup();

        state.currentView = view;
        $$('.nav-item').forEach(el => {
            const isActive = el.dataset.target === view;
            if (isActive) {
                el.classList.add('text-teal-600', 'dark:text-teal-400');
                el.classList.remove('text-gray-400');
            } else {
                el.classList.remove('text-teal-600', 'dark:text-teal-400');
                el.classList.add('text-gray-400');
            }
        });

        const container = $('#view-container');
        // Simple loading indicator for better UX
        container.innerHTML = '<div class="flex justify-center p-8"><i data-lucide="loader-2" class="animate-spin w-8 h-8 text-teal-600"></i></div>';
        lucide.createIcons();

        // Small delay to allow UI to paint loading state if needed, or just execute
        setTimeout(() => {
            if (this.routes[view]) {
                this.routes[view]();
            }
        }, 10);
    }
};

// --- View Renderers ---

function renderHome() {
    const container = $('#view-container');
    container.innerHTML = `
        <div class="space-y-6 animate-fade-in">
            <div class="bg-gradient-to-br from-teal-500 to-emerald-600 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
                <div class="absolute -right-10 -top-10 bg-white/10 w-40 h-40 rounded-full blur-2xl"></div>
                <div class="absolute -left-10 -bottom-10 bg-black/10 w-40 h-40 rounded-full blur-2xl"></div>
                
                <div class="relative z-10 text-center">
                    <h2 class="text-2xl font-bold mb-1">لوحة المتصدرين</h2>
                    <p class="text-teal-100 text-sm">أفضل الطلاب أداءً - ${(LEVELS[state.currentLevel] ? LEVELS[state.currentLevel].name : '')}</p>
                    
                    <div id="top-3-container" class="mt-6 flex justify-center items-end gap-4 h-32">
                        <i data-lucide="loader-2" class="w-8 h-8 animate-spin text-white"></i>
                    </div>
                </div>
            </div>

            ${state.isTeacher ? `
            <div class="grid grid-cols-2 gap-4">
                <button onclick="router.navigate('students')" class="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center gap-2 hover:border-teal-500 transition">
                    <div class="bg-teal-100 dark:bg-teal-900/40 p-3 rounded-xl text-teal-600 dark:text-teal-400">
                        <i data-lucide="user-plus" class="w-6 h-6"></i>
                    </div>
                    <span class="font-medium text-sm">إدارة الطلاب</span>
                </button>
                <button onclick="router.navigate('competitions')" class="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center gap-2 hover:border-teal-500 transition">
                    <div class="bg-purple-100 dark:bg-purple-900/40 p-3 rounded-xl text-purple-600 dark:text-purple-400">
                        <i data-lucide="trophy" class="w-6 h-6"></i>
                    </div>
                    <span class="font-medium text-sm">إدارة المسابقات</span>
                </button>
            </div>
            ` : ''}

            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="font-bold text-gray-800 dark:text-gray-100">المجموعات المتميزة</h3>
                    <span class="text-teal-600 text-xs font-bold bg-teal-50 dark:bg-teal-900/30 px-2 py-1 rounded-lg">الأعلى نقاطاً</span>
                </div>
                <div id="top-groups-list" class="space-y-3">
                     <div class="text-center py-4 text-gray-400 text-sm">جاري التحميل...</div>
                </div>
            </div>
        </div>
    `;

    // Fetch GLOBAL students for leaderboard calculation, scoped to LEVEL
    if (homeStudentsUnsubscribe) homeStudentsUnsubscribe();

    // Query filtered by current level
    const q = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "students"),
        window.firebaseOps.where("level", "==", state.currentLevel)
    );

    homeStudentsUnsubscribe = window.firebaseOps.onSnapshot(q, (snap) => {
        state.students = [];
        snap.forEach(function (d) {
            var data = d.data();
            data.id = d.id;
            state.students.push(data);
        });
        calculateLeaderboard();
    });

    if (scoresUnsubscribe) {
        scoresUnsubscribe();
    }

    // Listen to scores
    scoresUnsubscribe = window.firebaseOps.onSnapshot(window.firebaseOps.collection(window.db, "scores"), (snapshot) => {
        const scores = [];
        snapshot.forEach(doc => scores.push(doc.data()));
        state.scores = scores;
        calculateLeaderboard();
    });

    lucide.createIcons();
}

function calculateLeaderboard() {
    // 0. Filter by Active Competition (if any)
    const activeComp = state.competitions.find(function (c) { return c.active; });

    // 1. Calculate Student Totals
    const studentTotals = state.students.map(function (student) {
        // Filter scores for this student
        const myScores = state.scores.filter(function (s) {
            if (s.studentId !== student.id) return false;
            if (activeComp) return s.competitionId === activeComp.id;
            return true; // No active comp = show all
        });
        const total = myScores.reduce(function (sum, score) { return sum + parseInt(score.points); }, 0);
        var sClone = Object.assign({}, student);
        sClone.totalScore = total;
        return sClone;
    }).sort(function (a, b) { return b.totalScore - a.totalScore; });

    updateTop3UI(studentTotals.slice(0, 3));

    // 2. Calculate Group Totals (Fetching Freshly for Home)
    const gq = window.firebaseOps.query(window.firebaseOps.collection(window.db, "groups"));
    window.firebaseOps.getDocs(gq).then(function (snap) {
        const allGroups = [];
        snap.forEach(function (d) {
            var data = d.data();
            data.id = d.id;
            allGroups.push(data);
        });

        const validGroups = allGroups.filter(function (g) {
            if (g.level && g.level !== state.currentLevel) return false;
            if (activeComp) return g.competitionId === activeComp.id;
            return true;
        });

        const groupTotals = validGroups.map(function (group) {
            if (!group.members) {
                var gClone = Object.assign({}, group);
                gClone.totalScore = 0;
                return gClone;
            }
            var gTotal = 0;
            group.members.forEach(function (mId) {
                var sItem = studentTotals.find(function (s) { return s.id === mId; });
                var sScore = sItem ? sItem.totalScore : 0;
                gTotal += sScore;
            });
            var gFinal = Object.assign({}, group);
            gFinal.totalScore = gTotal;
            return gFinal;
        }).sort(function (a, b) { return b.totalScore - a.totalScore; });

        updateTopGroupsUI(groupTotals.slice(0, 5));
    });
}

function updateTop3UI(top3) {
    const container = $('#top-3-container');
    if (!container) return;

    if (top3.length === 0) {
        container.innerHTML = '<p class="text-white/70 text-sm pb-4">لا توجد بيانات بعد</p>';
        return;
    }

    // تصميم جديد أفضل - قائمة بسيطة وواضحة
    const medals = ['🥇', '🥈', '🥉'];
    const bgColors = ['bg-yellow-500/20', 'bg-gray-400/20', 'bg-orange-500/20'];

    container.innerHTML = `
        <div class="w-full space-y-2">
            ${top3.map((student, i) => {
        const iconHtml = student.icon && student.icon.startsWith('data:image')
            ? `<img src="${student.icon}" class="w-full h-full object-cover">`
            : (student.icon || '👤');
        return `
                <div class="flex items-center gap-3 ${bgColors[i]} backdrop-blur-sm rounded-xl px-3 py-2">
                    <span class="text-xl">${medals[i]}</span>
                    <div class="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-lg overflow-hidden border-2 border-white/50 shrink-0">
                        ${iconHtml}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold text-white text-sm truncate">${student.name}</p>
                    </div>
                    <div class="bg-white/20 px-3 py-1 rounded-lg">
                        <span class="font-bold text-white">${student.totalScore}</span>
                        <span class="text-white/70 text-xs">نقطة</span>
                    </div>
                </div>
            `}).join('')}
        </div>
    `;
}

function updateTopGroupsUI(groups) {
    const list = $('#top-groups-list');
    if (!list) return;

    if (groups.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">لا توجد مجموعات</p>';
        return;
    }

    list.innerHTML = groups.map((g, i) => {
        const isImg = g.icon && g.icon.startsWith('data:image');
        const iconHtml = isImg
            ? `<div class="w-10 h-10 rounded-full overflow-hidden border border-gray-200"><img src="${g.icon}" class="w-full h-full object-cover"></div>`
            : `<div class="text-2xl">${g.emoji || g.icon || '🛡️'}</div>`;

        return `
        <div class="flex items-center gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
            ${iconHtml}
            <div class="flex-1">
                <h4 class="font-bold text-sm text-gray-800 dark:text-gray-100">${g.name}</h4>
                <p class="text-xs text-gray-500">مجموع النقاط: ${g.totalScore}</p>
            </div>
            <span class="font-bold text-teal-600 text-lg">#${i + 1}</span>
        </div>
    `}).join('');
}

function renderCompetitions() {
    const container = $('#view-container');
    container.innerHTML = `
        <div class="space-y-4 animate-fade-in">
            <div class="flex justify-between items-center mb-2">
                <h2 class="text-xl font-bold">المسابقات - ${(LEVELS[state.currentLevel] ? LEVELS[state.currentLevel].name : '')}</h2>
                ${state.isTeacher ? `
                <button onclick="openAddCompetitionModal()" class="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg hover:bg-teal-700 transition flex items-center gap-2">
                    <i data-lucide="plus" class="w-4 h-4"></i>
                    جديد
                </button>
                ` : ''}
            </div>
            
            <div id="competitions-list" class="space-y-4 min-h-[100px] relative">
                <div class="bg-white dark:bg-gray-800 rounded-2xl p-8 py-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700">
                    <i data-lucide="loader-2" class="w-8 h-8 text-teal-600 animate-spin mx-auto mb-2"></i>
                    <p class="text-gray-500 text-sm">جاري التحميل...</p>
                </div>
            </div>
        </div>
        </div>
        
        <!-- Fix confirmResetScores and confirmNuclearWipe definitions -->
        <script>
        // These are global functions called by onclick in renderSettings
        </script>
    `;

    // Ensure modals are in body
    ensureGlobalModals();

    // Firestore Listener
    if (competitionsUnsubscribe) {
        competitionsUnsubscribe();
        competitionsUnsubscribe = null;
    }

    // Firestore Listener
    if (competitionsUnsubscribe) {
        competitionsUnsubscribe();
    }

    const q = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "competitions")
    );

    competitionsUnsubscribe = window.firebaseOps.onSnapshot(q, function (snapshot) {
        const comps = [];
        snapshot.forEach(function (doc) {
            var data = doc.data();
            data.id = doc.id;
            // Filter by level or 'general' (documents without level field)
            if (!data.level || data.level === state.currentLevel) {
                comps.push(data);
            }
        });
        // Client-side Sort
        comps.sort(function (a, b) {
            const aSec = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
            const bSec = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
            return bSec - aSec;
        });
        state.competitions = comps;
        updateCompetitionsListUI();
    });
    lucide.createIcons();
}

function updateCompetitionsListUI() {
    const list = $('#competitions-list');
    if (!list) return;

    if (state.competitions.length === 0) {
        list.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-8 py-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700">
                <div class="inline-block p-4 bg-gray-100 dark:bg-gray-700 rounded-full mb-4">
                    <i data-lucide="trophy" class="w-8 h-8 text-gray-400"></i>
                </div>
                <h3 class="text-gray-900 dark:text-white font-bold">لا توجد مسابقات حالياً</h3>
                <p class="text-gray-500 text-sm mt-1">المسابقات التي يتم إنشاؤها ستظهر هنا</p>
            </div>
        `;
    } else {
        list.innerHTML = state.competitions.map(comp => `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 hover:shadow-md transition border border-transparent hover:border-teal-100 dark:hover:border-teal-900">
                <div class="flex items-center gap-4 mb-3">
                    <div class="w-12 h-12 bg-teal-50 dark:bg-teal-900/20 rounded-xl flex items-center justify-center text-2xl">
                        ${comp.icon || '🏆'}
                    </div>
                    <div>
                        <h3 class="font-bold text-gray-900 dark:text-white">${comp.name}</h3>
                        <p class="text-xs text-gray-500">${comp.level ? (LEVELS[comp.level] ? LEVELS[comp.level].name : 'عام') : 'عام'}</p>
                    </div>
                ${state.isTeacher ? `
                <div class="mr-auto flex gap-1">
                    <button onclick="toggleCompetitionActive('${comp.id}')" class="p-2 rounded-lg transition ${comp.active ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 hover:text-yellow-500 hover:bg-yellow-50'}" title="${comp.active ? 'نشطة (تظهر للطلاب)' : 'تفعيل للعرض'}">
                        <i data-lucide="star" class="w-4 h-4 ${comp.active ? 'fill-yellow-500' : ''}"></i>
                    </button>
                    <button onclick="openEditCompetition('${comp.id}')" class="p-2 text-teal-600 hover:bg-teal-50 rounded-lg transition" title="تعديل">
                        <i data-lucide="edit-2" class="w-4 h-4"></i>
                    </button>
                    <button onclick="resetCompetition('${comp.id}')" class="p-2 text-orange-500 hover:bg-orange-50 rounded-lg transition" title="تصفير الدرجات">
                        <i data-lucide="refresh-ccw" class="w-4 h-4"></i>
                    </button>
                    <button onclick="deleteCompetition('${comp.id}')" class="p-2 text-red-400 hover:bg-red-50 rounded-lg transition" title="حذف">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
                ` : ''}
                </div>
                
                <div class="grid grid-cols-2 gap-2 mt-4">
                    ${state.isTeacher ? `
                    <button onclick="openGradingSession('${comp.id}')" class="bg-teal-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-teal-700 transition flex items-center justify-center gap-2">
                        <i data-lucide="star" class="w-4 h-4"></i>
                        رصد درجات
                    </button>
                    ` : ''}
                     <button onclick="openManageGroups('${comp.id}', '${comp.name}')" class="${state.isTeacher ? '' : 'col-span-2'} bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 py-2 rounded-xl text-sm font-bold hover:bg-gray-200 transition flex items-center justify-center gap-2">
                        <i data-lucide="users" class="w-4 h-4"></i>
                        المجموعات
                    </button>
                </div>
            </div>
        `).join('');
    }
    lucide.createIcons();
}

function renderStudents() {
    const container = $('#view-container');
    container.innerHTML = `
        <div class="space-y-4 animate-fade-in">
            <div class="flex justify-between items-center mb-2">
                <h2 class="text-xl font-bold">الطلاب - ${(LEVELS[state.currentLevel] ? LEVELS[state.currentLevel].name : '')}</h2>
                ${state.isTeacher ? `
                <button onclick="openAddStudentModal()" class="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg hover:bg-teal-700 transition flex items-center gap-2">
                    <i data-lucide="user-plus" class="w-4 h-4"></i>
                    جديد
                </button>
                ` : ''}
            </div>

            <div id="students-list" class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden min-h-[100px] relative">
                <div class="flex flex-col items-center justify-center py-8 text-gray-400">
                     <i data-lucide="loader-2" class="w-6 h-6 animate-spin mb-2"></i>
                     <p class="text-xs">جاري جلب الطلاب...</p>
                </div>
            </div>
        </div>
        </div>
    `;

    // Ensure modals are in body
    ensureGlobalModals();

    // Performance: If we have cached data, show it immediately
    if (state.students && state.students.length > 0) {
        updateStudentsListUI();
    }

    // Listener
    if (studentsUnsubscribe) {
        studentsUnsubscribe();
        studentsUnsubscribe = null;
    }

    const q = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "students"),
        window.firebaseOps.where("level", "==", state.currentLevel)
        // orderBy removed to avoid Index Error
    );

    studentsUnsubscribe = window.firebaseOps.onSnapshot(q, (snapshot) => {
        const students = [];
        snapshot.forEach((doc) => {
            var data = doc.data();
            data.id = doc.id;
            students.push(data);
        });
        // Client-side Sort
        students.sort((a, b) => {
            const aSec = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
            const bSec = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
            return bSec - aSec;
        });
        state.students = students;
        updateStudentsListUI();
    });
    lucide.createIcons();
}

function updateStudentsListUI() {
    const list = $('#students-list');
    if (!list) return;

    if (state.students.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-gray-400">
                <i data-lucide="users" class="w-12 h-12 mb-3 opacity-20"></i>
                <p class="text-sm font-medium">لا يوجد طلاب حتى الآن</p>
                ${state.isTeacher ? '<p class="text-xs mt-1">اضغط على "جديد" لإضافة طلاب</p>' : ''}
            </div>
        `;
    } else {
        list.innerHTML = state.students.map(student => {
            const isImg = student.icon && student.icon.startsWith('data:image');
            const iconHtml = isImg
                ? `<img src="${student.icon}" class="w-full h-full object-cover">`
                : (student.icon || '👤');

            return `
            <div class="p-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition group border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div onclick="openEditStudent('${student.id}')" class="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-xl shadow-sm border border-gray-200 dark:border-gray-600 overflow-hidden cursor-pointer shrink-0">
                    ${iconHtml}
                </div>
                <div class="flex-1 min-w-0" onclick="openEditStudent('${student.id}')" style="cursor:pointer">
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 truncate">${student.name}</h4>
                    <div class="flex flex-wrap gap-1 text-xs text-gray-500 mt-0.5">
                        ${(state.isTeacher && student.studentNumber) ? `<span class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-[10px] text-gray-500 tracking-wider">${student.studentNumber}</span>` : ''}
                        ${student.password ? '<span class="text-green-500">🔐</span>' : '<span class="text-orange-400">⚠️ بدون كلمة مرور</span>'}
                    </div>
                </div>
                <div class="flex gap-1 shrink-0">
                    <button onclick="event.stopPropagation(); openEditStudent('${student.id}')" class="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded-lg transition" title="تعديل">
                        <i data-lucide="edit-2" class="w-4 h-4"></i>
                    </button>
                    ${state.isTeacher ? `
                    <button onclick="event.stopPropagation(); confirmDeleteStudent('${student.id}')" class="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition" title="حذف">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
        `}).join('');
        lucide.createIcons();
    }
}

// نقل الطالب لمرحلة أخرى - فتح نافذة الاختيار
function openTransferStudent(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;

    // تعبئة بيانات النافذة
    $('#transfer-student-id').value = studentId;
    $('#transfer-student-name').textContent = `نقل "${student.name}" إلى مرحلة أخرى`;

    // تعبئة قائمة المراحل (استثناء المرحلة الحالية)
    const select = $('#transfer-target-level');
    select.innerHTML = '<option value="">-- اختر المرحلة --</option>';

    Object.entries(LEVELS).forEach(([key, val]) => {
        if (key !== state.currentLevel) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${val.emoji} ${val.name}`;
            select.appendChild(option);
        }
    });

    toggleModal('transfer-modal', true);
    lucide.createIcons();
}

// تأكيد نقل الطالب
async function confirmTransferStudent() {
    const studentId = $('#transfer-student-id').value;
    const targetLevel = $('#transfer-target-level').value;

    if (!studentId || !targetLevel) {
        showToast("يرجى اختيار المرحلة", "error");
        return;
    }

    try {
        await window.firebaseOps.updateDoc(
            window.firebaseOps.doc(window.db, "students", studentId),
            { level: targetLevel, updatedAt: new Date() }
        );
        showToast(`تم نقل الطالب إلى ${LEVELS[targetLevel].name}`);
        closeModal('transfer-modal');
    } catch (e) {
        console.error(e);
        showToast("فشل النقل", "error");
    }
}

function renderSettings() {
    const container = $('#view-container');

    // Load teacher info if teacher
    let teacherInfoHTML = '';
    if (state.isTeacher) {
        teacherInfoHTML = `
             <!-- Teacher Contact Info -->
             <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border">
                 <h3 class="font-bold mb-4 flex items-center gap-2"><i data-lucide="users" class="w-5 h-5 text-purple-600"></i> المعلمون</h3>
                 <p class="text-xs text-gray-500 mb-3">هذه البيانات ستظهر لولي الأمر للتواصل</p>
                 
                 <!-- Teachers List -->
                 <div id="teachers-list" class="space-y-2 mb-4">
                     <div class="text-center py-2 text-gray-400"><i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto"></i></div>
                 </div>

                 <!-- Add New Teacher -->
                 <div class="border-t pt-4 mt-4">
                     <h4 class="font-bold text-sm mb-3 text-purple-600">➕ إضافة معلم جديد</h4>
                     <div class="space-y-3">
                         <div>
                             <label class="block text-sm font-bold mb-1">اسم المعلم</label>
                             <input type="text" id="teacher-name-setting" class="w-full bg-gray-50 dark:bg-gray-700 border rounded-xl px-4 py-2" placeholder="الأستاذ محمد">
                         </div>
                         <div>
                             <label class="block text-sm font-bold mb-1">رقم الجوال (WhatsApp)</label>
                             <input type="tel" id="teacher-phone-setting" dir="ltr" class="w-full bg-gray-50 dark:bg-gray-700 border rounded-xl px-4 py-2 text-left" placeholder="966xxxxxxxxx">
                             <p class="text-xs text-gray-400 mt-1">الأرقام السعودية: أدخل 966 أو 05</p>
                         </div>
                         <button onclick="addNewTeacher()" class="w-full py-2 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 transition">
                             إضافة المعلم
                         </button>
                     </div>
                 </div>
             </div>
        `;
    }

    container.innerHTML = `
        <div class="space-y-4 animate-fade-in">
             <h2 class="text-xl font-bold mb-4">الإعدادات</h2>
             
             <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
                 <div class="flex items-center justify-between">
                     <div class="flex items-center gap-3">
                         <div class="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg">
                             <i data-lucide="moon" class="w-5 h-5 text-gray-600 dark:text-gray-300"></i>
                         </div>
                         <span class="font-medium">الوضع الليلي</span>
                     </div>
                     <button onclick="toggleTheme()" class="w-12 h-7 bg-gray-200 dark:bg-teal-600 rounded-full relative transition-colors duration-300">
                         <div class="w-5 h-5 bg-white rounded-full absolute top-1 left-1 dark:left-6 transition-all duration-300 shadow-sm"></div>
                     </button>
                 </div>
             </div>

             ${teacherInfoHTML}
             
             <div class="text-center text-xs text-gray-400 mt-8">
                 <p>برنامج المتابعة - النسخة التجريبية - إصدار v4.2.0</p>
                 <p>جميع الحقوق محفوظة</p>
             </div>
        </div>
    `;
    lucide.createIcons();

    // Load existing teachers list
    if (state.isTeacher) {
        loadTeachersList();
    }
}

function forceUpdateApp() {
    showToast("جاري التحديث الشامل...");

    // 1. Unregister all service workers if possible
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
            for (var i = 0; i < registrations.length; i++) {
                registrations[i].unregister();
            }
        });
    }

    // 2. Clear caches
    if ('caches' in window) {
        caches.keys().then(function (names) {
            for (var name of names) caches.delete(name);
        });
    }

    // 3. Reload with force (cache: reload)
    setTimeout(function () {
        window.location.reload(true);
    }, 1000);
}

async function loadTeachersList() {
    const listContainer = $('#teachers-list');
    if (!listContainer) return;

    try {
        const q = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "teachers"),
            window.firebaseOps.where("level", "==", state.currentLevel)
        );
        const snap = await window.firebaseOps.getDocs(q);

        if (snap.empty) {
            listContainer.innerHTML = '<p class="text-center text-gray-400 text-sm py-2">لا يوجد معلمون مسجلون حالياً</p>';
            return;
        }

        let html = '';
        snap.forEach(doc => {
            const t = doc.data();
            html += `
            <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-xl p-3">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center text-lg">👨‍🏫</div>
                    <div>
                        <p class="font-bold text-sm">${t.name}</p>
                        <p class="text-xs text-gray-500" dir="ltr">${t.phone}</p>
                    </div>
                </div>
                <button onclick="deleteTeacher('${doc.id}')" class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
            `;
        });

        listContainer.innerHTML = html;
        lucide.createIcons();
    } catch (e) {
        console.error("Error loading teachers:", e);
        listContainer.innerHTML = '<p class="text-center text-red-500 text-sm py-2">خطأ في تحميل البيانات</p>';
    }
}

async function addNewTeacher() {
    const nameEl = $('#teacher-name-setting');
    const phoneEl = $('#teacher-phone-setting');
    const name = nameEl ? nameEl.value.trim() : '';
    let phone = phoneEl ? phoneEl.value.trim() : '';

    if (!name || !phone) {
        showToast("الرجاء إدخال الاسم والرقم", "error");
        return;
    }

    // Normalize phone
    phone = normalizePhone(phone);

    try {
        const data = {
            name,
            phone,
            level: state.currentLevel,
            createdAt: new Date().toISOString()
        };

        await window.firebaseOps.addDoc(window.firebaseOps.collection(window.db, "teachers"), data);
        showToast("تم إضافة المعلم بنجاح ✅");

        // Clear inputs
        $('#teacher-name-setting').value = '';
        $('#teacher-phone-setting').value = '';

        // Reload list
        loadTeachersList();
    } catch (e) {
        console.error(e);
        showToast("خطأ في الإضافة", "error");
    }
}

async function deleteTeacher(teacherId) {
    // Create confirmation modal instead of confirm() which may not work in WebView
    let modal = document.getElementById('confirm-delete-teacher-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirm-delete-teacher-modal';
        document.body.appendChild(modal);
    }

    modal.className = 'fixed inset-0 bg-black/50 z-[150] flex items-center justify-center p-4 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div class="bg-red-100 dark:bg-red-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400">
                <i data-lucide="trash-2" class="w-8 h-8"></i>
            </div>
            <h3 class="font-bold text-lg mb-2">حذف المعلم؟</h3>
            <p class="text-gray-500 text-sm mb-6">هل أنت متأكد من حذف هذا المعلم؟</p>
            <div class="flex gap-3">
                <button onclick="document.getElementById('confirm-delete-teacher-modal').remove()" class="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">إلغاء</button>
                <button onclick="confirmDeleteTeacher('${teacherId}')" class="flex-1 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 shadow-lg">حذف</button>
            </div>
        </div>
    `;

    lucide.createIcons();
}

async function confirmDeleteTeacher(teacherId) {
    const teacherModal = document.getElementById('confirm-delete-teacher-modal');
    if (teacherModal) teacherModal.remove();
    try {
        await window.firebaseOps.deleteDoc(window.firebaseOps.doc(window.db, "teachers", teacherId));
        showToast("تم حذف المعلم");
        loadTeachersList();
    } catch (e) {
        console.error(e);
        showToast("خطأ في الحذف", "error");
    }
}

function toggleTheme() {
    state.darkMode = !state.darkMode;
    applyTheme();
    localStorage.setItem('darkMode', state.darkMode);
}

function applyTheme() {
    if (state.darkMode) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

// --- Modals HTML generation to keep JS clean ---
// Implement Data Wipe Functions here (Global Scope)
// Data Wipe Functions Removed per user request

function getStudentModalHTML() {
    return `
    <div id="student-modal" class="fixed inset-0 bg-black/50 z-[100] hidden flex items-center justify-center p-0 sm:p-4 backdrop-blur-sm">
        <div class="bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 shadow-2xl h-[90vh] sm:h-auto overflow-y-auto">
             <h3 id="student-modal-title" class="text-lg font-bold mb-6">إضافة طالب جديد</h3>
             <form id="student-form" onsubmit="handleSaveStudent(event)">
                 <input type="hidden" id="student-id">
                 
                 <div class="mb-4 flex flex-col items-center gap-3">
                        <div id="student-emoji-preview" class="w-24 h-24 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-4xl shadow-inner border-2 border-dashed border-gray-300 dark:border-gray-600 overflow-hidden">
                            👤
                        </div>
                        <div class="flex gap-2">
                             <button type="button" onclick="openImagePicker()" class="flex items-center gap-2 px-4 py-2 bg-teal-50 dark:bg-teal-900/30 text-teal-600 rounded-xl text-sm font-medium hover:bg-teal-100 transition">
                                 <i data-lucide="image" class="w-4 h-4"></i>
                                 رفع صورة
                             </button>
                             <button type="button" onclick="openEmojiPicker()" class="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/30 text-amber-600 rounded-xl text-sm font-medium hover:bg-amber-100 transition">
                                 <i data-lucide="smile" class="w-4 h-4"></i>
                                 إيموجي
                             </button>
                        </div>
                        <input type="file" id="student-image-upload" accept="image/*" class="hidden" onchange="previewStudentImage(this)">
                        <input type="hidden" id="student-emoji" value="👤">
                 </div>

                 <div class="space-y-3">
                     <div>
                         <label class="block text-sm font-bold mb-1">اسم الطالب</label>
                         <input type="text" id="student-name" required class="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 rounded-xl px-4 py-3">
                     </div>

                     <div>
                         <label class="block text-sm font-bold mb-1">رقم ولي الأمر (واتساب)</label>
                         <input type="tel" id="student-number" class="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 rounded-xl px-4 py-3" placeholder="مثال: 966500000000">
                         <p class="text-xs text-gray-400 mt-1">يستخدم للتواصل عبر واتساب عند الغياب</p>
                     </div>
                     
                     <div class="grid grid-cols-2 gap-4">
                         <div>
                             <label class="block text-sm font-bold mb-1">خطة الحفظ</label>
                             <input type="text" id="student-memorization" class="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 rounded-xl px-4 py-3">
                         </div>
                         <div>
                             <label class="block text-sm font-bold mb-1">خطة المراجعة</label>
                             <input type="text" id="student-review" class="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 rounded-xl px-4 py-3">
                         </div>
                     </div>
                     
                     <div class="mb-2">
                         <label class="block text-sm font-bold mb-1">كلمة المرور</label>
                         <input type="text" id="student-password-edit" class="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 rounded-xl px-4 py-3" placeholder="كلمة المرور (إلزامي للطلاب الجدد)">
                         <p id="password-error" class="hidden text-red-500 text-xs mt-1 font-bold">⚠️ كلمة المرور مطلوبة للطالب الجديد</p>
                     </div>
                     
                     <div class="flex gap-3 mt-6">
                         <button type="button" onclick="closeModal('student-modal')" class="flex-1 py-3 rounded-xl text-gray-600 hover:bg-gray-100 font-bold transition">إلغاء</button>
                         <button type="submit" id="save-student-btn" class="flex-1 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 transition"><span id="save-student-text">حفظ</span></button>
                     </div>
                 </div>
             </form>
        </div>
    </div>
    
    <div id="emoji-picker-modal" class="fixed inset-0 bg-black/50 z-[100] hidden flex items-center justify-center p-4 backdrop-blur-sm">
        <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-xs p-4 shadow-2xl">
            <h3 class="font-bold text-center mb-4">اختر إيموجي</h3>
            <div id="emoji-grid" class="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto"></div>
            <button onclick="closeModal('emoji-picker-modal')" class="w-full mt-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 font-medium">إغلاق</button>
        </div>
    </div>

    <div id="delete-modal" class="fixed inset-0 bg-black/50 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm">
         <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div class="bg-red-100 dark:bg-red-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400">
                <i data-lucide="alert-triangle" class="w-8 h-8"></i>
            </div>
            <h3 class="font-bold text-lg mb-2">تأكيد الحذف</h3>
            <p class="text-gray-500 text-sm mb-6">لا يمكن التراجع عن هذه العملية.</p>
            <div class="flex gap-3">
                <button onclick="closeModal('delete-modal')" class="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">إلغاء</button>
                <button id="confirm-delete-btn" class="flex-1 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 shadow-lg">حذف</button>
            </div>
         </div>
    </div>
    `;
}

// فتح اختيار الصورة من المعرض
function openImagePicker() {
    document.getElementById('student-image-upload').click();
}

// فتح اختيار الإيموجي
function openEmojiPicker() {
    const emojis = ["👤", "🎓", "🏆", "🌟", "📚", "🕌", "⚽", "🧠", "⚔️", "🛡️", "🎒", "🧸", "👦", "👧", "👨‍🎓", "👩‍🎓", "🦁", "🐯", "🦅", "🐎", "🌙", "☀️", "⭐", "🚀", "💪", "🎯", "📖", "✏️", "🎨", "🎵"];

    const grid = document.getElementById('emoji-grid');
    grid.innerHTML = emojis.map(e => `
                        <button type="button" onclick="selectEmoji('${e}')" class="w-12 h-12 text-2xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition flex items-center justify-center">
                            ${e}
                        </button>
                        `).join('');

    toggleModal('emoji-picker-modal', true);
}

// اختيار إيموجي
function selectEmoji(emoji) {
    document.getElementById('student-emoji').value = emoji;
    document.getElementById('student-emoji-preview').innerHTML = emoji;
    // مسح أي صورة مرفوعة
    document.getElementById('student-image-upload').value = '';
    closeModal('emoji-picker-modal');
}

async function previewStudentImage(input) {
    if (input.files && input.files[0]) {
        const compressed = await compressImage(input.files[0]);
        const preview = document.getElementById('student-emoji-preview');
        preview.innerHTML = `<img src="${compressed}" class="w-full h-full object-cover">`;
        // مسح قيمة الإيموجي لأن الصورة أولوية
        document.getElementById('student-emoji').value = '';
    }
}

function getCompetitionModalsHTML() {
    // Similar to student modal but for competitions + groups
    return `
                            <div id="competition-modal" class="fixed inset-0 bg-black/50 z-[100] hidden flex items-center justify-center p-0 sm:p-4 backdrop-blur-sm">
                                <div class="bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 shadow-2xl h-[90vh] sm:h-auto overflow-y-auto">
                                    <div class="flex justify-between items-center mb-6">
                                        <h3 class="text-lg font-bold">إنشاء مسابقة جديدة</h3>
                                        <button onclick="closeModal('competition-modal')"><i data-lucide="x"></i></button>
                                    </div>
                                    <form id="competition-form" onsubmit="handleSaveCompetition(event)">
                                        <input type="hidden" id="competition-id">
                                            <div class="flex gap-4 mb-4">
                                                <div class="relative group cursor-pointer shrink-0" onclick="toggleEmojiPicker('competition-emoji-btn')">
                                                    <div id="competition-emoji-preview" class="w-16 h-16 bg-teal-50 dark:bg-gray-700 rounded-xl border-2 border-dashed border-teal-300 flex items-center justify-center text-3xl">🏆</div>
                                                    <input type="hidden" id="competition-emoji" value="🏆">
                                                </div>
                                                <div class="flex-1">
                                                    <label class="block text-sm font-bold mb-1">اسم المسابقة</label>
                                                    <input type="text" id="competition-name" required class="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 rounded-xl px-4 py-3">
                                                </div>
                                            </div>

                                            <div class="mb-4">
                                                <label class="block text-sm font-bold mb-2">معايير التقييم</label>
                                                <div id="criteria-list" class="space-y-2 mb-2"></div>
                                                <button type="button" onclick="addCriteriaItem()" class="text-teal-600 text-sm font-bold flex items-center gap-1">+ إضافة معيار</button>
                                            </div>

                                            <div class="mb-4 bg-orange-50 dark:bg-orange-900/10 p-4 rounded-xl border border-orange-100 dark:border-orange-800">
                                                <h4 class="font-bold text-sm text-orange-800 dark:text-orange-300 mb-3 flex items-center gap-2">
                                                    <i data-lucide="user-x" class="w-4 h-4"></i>
                                                    إعدادات خصم الغياب
                                                </h4>
                                                <div class="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label class="block text-xs font-bold mb-1">بعذر (نقاط)</label>
                                                        <input type="number" id="comp-absent-excuse" class="w-full bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700 rounded-lg px-3 py-2 text-center" value="1">
                                                    </div>
                                                    <div>
                                                        <label class="block text-xs font-bold mb-1">بدون عذر (نقاط)</label>
                                                        <input type="number" id="comp-absent-no-excuse" class="w-full bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-700 rounded-lg px-3 py-2 text-center" value="4">
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div class="mb-4 bg-purple-50 dark:bg-purple-900/10 p-3 rounded-xl border border-purple-100 dark:border-purple-800">
                                                <h4 class="font-bold text-sm text-purple-800 dark:text-purple-300 mb-3 flex items-center gap-2">
                                                    <i data-lucide="zap" class="w-4 h-4"></i>
                                                    إعدادات يوم النشاط
                                                </h4>
                                                <div class="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label class="block text-[10px] font-bold mb-1">نقاط الحضور</label>
                                                        <input type="number" id="comp-activity-points" class="w-full bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-700 rounded-lg px-3 py-2 text-center text-sm" value="">
                                                    </div>
                                                    <div>
                                                        <label class="block text-[10px] font-bold mb-1 text-red-600">نقاط الخصم (غائب)</label>
                                                        <input type="number" id="comp-activity-absent-points" class="w-full bg-white dark:bg-gray-800 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2 text-center text-sm text-red-600" value="">
                                                    </div>
                                                </div>
                                            </div>

                                            <button type="submit" id="save-competition-btn" class="w-full bg-teal-600 text-white py-3 rounded-xl font-bold hover:bg-teal-700 transition">حفظ المسابقة</button>
                                    </form>
                                </div>
                            </div>

                            <div id="groups-modal" class="fixed inset-0 bg-black/50 z-[100] hidden flex items-center justify-center p-4 backdrop-blur-sm">
                                <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg p-0 shadow-2xl max-h-[80vh] flex flex-col">
                                    <div class="p-4 border-b flex justify-between shrink-0">
                                        <div><h3 class="font-bold">إدارة المجموعات</h3><p id="groups-comp-name" class="text-xs text-gray-500"></p></div>
                                        <button onclick="closeModal('groups-modal')"><i data-lucide="x"></i></button>
                                    </div>
                                    <div class="p-4 flex-1 overflow-y-auto">
                                        <button id="add-group-btn" onclick="openAddGroupModal()" class="w-full py-3 border-2 border-dashed border-teal-300 text-teal-600 rounded-xl font-bold mb-4 hover:bg-teal-50 transition hidden">+ مجموعة جديدة</button>
                                        <div id="groups-container" class="space-y-3"></div>
                                    </div>
                                </div>
                            </div>

                            <!-- Add/Edit Group Modal -->
                            <div id="edit-group-modal" class="fixed inset-0 bg-black/60 z-[100] hidden flex items-center justify-center p-4">
                                <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
                                    <div class="flex justify-between items-center mb-4">
                                        <h3 id="group-modal-title" class="font-bold text-lg">إضافة مجموعة</h3>
                                        <button onclick="closeModal('edit-group-modal')" class="text-gray-400 hover:text-gray-600"><i data-lucide="x"></i></button>
                                    </div>

                                    <input type="hidden" id="edit-group-id">

                                        <!-- Group Icon -->
                                        <div class="flex items-center gap-4 mb-4">
                                            <div id="group-icon-preview" class="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center text-3xl border-2 border-dashed border-gray-300 overflow-hidden cursor-pointer" onclick="document.getElementById('group-image-upload').click()">
                                                🛡️
                                            </div>
                                            <div class="flex-1">
                                                <input type="text" id="edit-group-name" placeholder="اسم المجموعة" class="w-full mb-2 bg-gray-50 dark:bg-gray-700 border rounded-xl px-4 py-2">
                                                    <div class="flex gap-2">
                                                        <button type="button" onclick="document.getElementById('group-image-upload').click()" class="text-xs bg-teal-50 text-teal-600 px-3 py-1 rounded-lg hover:bg-teal-100">📷 صورة</button>
                                                        <button type="button" onclick="cycleGroupEmoji()" class="text-xs bg-amber-50 text-amber-600 px-3 py-1 rounded-lg hover:bg-amber-100">😊 إيموجي</button>
                                                    </div>
                                            </div>
                                        </div>
                                        <input type="file" id="group-image-upload" accept="image/*" class="hidden" onchange="previewGroupImage(this)">
                                            <input type="hidden" id="group-icon" value="🛡️">

                                                <!-- Leader & Deputy -->
                                                <div class="grid grid-cols-2 gap-3 mb-4">
                                                    <div>
                                                        <label class="block text-xs font-bold text-gray-500 mb-1">👑 القائد</label>
                                                        <select id="group-leader" class="w-full bg-gray-50 dark:bg-gray-700 border rounded-xl px-3 py-2 text-sm">
                                                            <option value="">-- اختر --</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label class="block text-xs font-bold text-gray-500 mb-1">⭐ النائب</label>
                                                        <select id="group-deputy" class="w-full bg-gray-50 dark:bg-gray-700 border rounded-xl px-3 py-2 text-sm">
                                                            <option value="">-- اختر --</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                <!-- Members -->
                                                <div class="mb-4">
                                                    <label class="block text-xs font-bold text-gray-500 mb-2">باقي الأعضاء</label>
                                                    <div id="group-members-selection" class="max-h-32 overflow-y-auto border rounded-xl p-2 bg-gray-50 dark:bg-gray-700"></div>
                                                </div>

                                                <div class="flex gap-2">
                                                    <button onclick="closeModal('edit-group-modal')" class="flex-1 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 font-medium">إلغاء</button>
                                                    <button onclick="saveGroupChanges()" class="flex-1 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700">حفظ</button>
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Transfer Student Modal -->
                                        <div id="transfer-modal" class="fixed inset-0 bg-black/60 z-[100] hidden flex items-center justify-center p-4">
                                            <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                                                <div class="flex justify-between items-center mb-4">
                                                    <h3 class="font-bold text-lg">نقل الطالب</h3>
                                                    <button onclick="closeModal('transfer-modal')" class="text-gray-400 hover:text-gray-600"><i data-lucide="x"></i></button>
                                                </div>

                                                <input type="hidden" id="transfer-student-id">

                                                    <p id="transfer-student-name" class="text-center text-gray-600 dark:text-gray-300 mb-4 font-medium"></p>

                                                    <label class="block text-sm font-bold text-gray-500 mb-2">اختر المرحلة الجديدة:</label>
                                                    <select id="transfer-target-level" class="w-full bg-gray-50 dark:bg-gray-700 border rounded-xl px-4 py-3 mb-4 text-lg">
                                                        <option value="">-- اختر المرحلة --</option>
                                                    </select>

                                                    <div class="flex gap-2">
                                                        <button onclick="closeModal('transfer-modal')" class="flex-1 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 font-medium">إلغاء</button>
                                                        <button onclick="confirmTransferStudent()" class="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">تأكيد النقل</button>
                                                    </div>
                                            </div>
                                        </div>

                                        <!-- Delete Competition Modal -->
                                        <div id="delete-competition-modal" class="fixed inset-0 bg-black/50 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm">
                                            <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
                                                <div class="bg-red-100 dark:bg-red-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400">
                                                    <i data-lucide="alert-triangle" class="w-8 h-8"></i>
                                                </div>
                                                <h3 class="font-bold text-lg mb-2">حذف المسابقة؟</h3>
                                                <p class="text-gray-500 text-sm mb-6">سيتم حذف جميع المجموعات والدرجات المرتبطة بها. هذا الإجراء لا يمكن التراجع عنه.</p>
                                                <div class="flex gap-3">
                                                    <button onclick="closeModal('delete-competition-modal')" class="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">إلغاء</button>
                                                    <button id="confirm-delete-comp-btn" class="flex-1 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 shadow-lg">حذف نهائي</button>
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Reset Competition Modal -->
                                        <div id="reset-competition-modal" class="fixed inset-0 bg-black/50 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm">
                                            <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
                                                <div class="bg-orange-100 dark:bg-orange-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-orange-600 dark:text-orange-400">
                                                    <i data-lucide="refresh-ccw" class="w-8 h-8"></i>
                                                </div>
                                                <h3 class="font-bold text-lg mb-2">تصفير المسابقة؟</h3>
                                                <p class="text-gray-500 text-sm mb-6">سيتم حذف جميع الدرجات والغياب المسجل في هذه المسابقة فقط. ستبقى المجموعات والطلاب والمعايير كما هي.</p>
                                                <div class="flex gap-3">
                                                    <button onclick="closeModal('reset-competition-modal')" class="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">إلغاء</button>
                                                    <button id="confirm-reset-comp-btn" class="flex-1 py-2 rounded-xl bg-orange-600 text-white hover:bg-orange-700 shadow-lg font-bold">تصفير الآن</button>
                                                </div>
                                            </div>
                                        </div>
                                        `;
}



function getGradingModalsHTML() {
    return `
                                        <div id="grading-modal" class="fixed inset-0 bg-black/50 z-[100] hidden flex items-center justify-center p-4 backdrop-blur-sm">
                                            <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg p-0 shadow-2xl max-h-[80vh] flex flex-col">
                                                <!-- Header -->
                                                <div class="p-4 border-b flex justify-between shrink-0 items-center">
                                                    <h3 class="font-bold text-lg">رصد الدرجات</h3>
                                                    <button onclick="closeModal('grading-modal')" class="text-gray-500 hover:bg-gray-100 p-1 rounded-full"><i data-lucide="x"></i></button>
                                                </div>
                                                
                                                <!-- Body -->
                                                <div class="p-4 flex-1 overflow-y-auto">
                                                    <!-- Date Picker Section -->
                                                    <div class="mb-4 bg-gray-50 dark:bg-gray-700 p-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
                                                        <div class="flex items-center gap-3">
                                                            <div class="bg-white dark:bg-gray-600 p-2 rounded-lg shadow-sm border">📅</div>
                                                            <div class="flex-1">
                                                                <p class="text-xs text-gray-500 mb-1">تاريخ الرصد</p>
                                                                <input type="date" id="grading-date" class="w-full bg-transparent font-bold text-gray-700 dark:text-gray-200 outline-none" onchange="refreshGradingStatus()">
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <!-- List Container -->
                                                    <div id="grading-students-list" class="space-y-3"></div>
                                                </div>
                                            </div>
                                        </div>

                                        <div id="rate-student-modal" class="fixed inset-0 bg-black/60 z-[100] hidden flex items-center justify-center p-4">
                                            <div class="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
                                                <div class="flex justify-between items-center mb-6">
                                                    <h3 id="rate-student-name" class="font-bold text-lg">اسم الطالب</h3>
                                                    <button onclick="closeModal('rate-student-modal')"><i data-lucide="x"></i></button>
                                                </div>
                                                <p id="rate-date-display" class="text-center text-sm text-gray-500 mb-4 font-bold bg-gray-100 dark:bg-gray-700 py-1 rounded-lg"></p>
                                                <div id="criteria-buttons-grid" class="grid grid-cols-1 gap-3 max-h-[50vh] overflow-y-auto"></div>
                                            </div>
                                        </div>

                                        <!-- Activity Day Modals -->
                                        <div id="activity-check-modal" class="fixed inset-0 bg-black/60 z-[120] hidden flex items-center justify-center p-4 backdrop-blur-sm">
                                            <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[85vh]">
                                                <h3 class="font-bold text-lg mb-2">تسجيل يوم نشاط 🏃</h3>
                                                <p class="text-xs text-gray-500 mb-4">حدد الطلاب الغائبين ليتم استثناؤهم من النقاط:</p>
                                                <div id="activity-students-list" class="flex-1 overflow-y-auto mb-4 border rounded-xl divide-y dark:divide-gray-700"></div>
                                                <div class="flex gap-2">
                                                    <button onclick="closeModal('activity-check-modal')" class="flex-1 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 font-medium">إلغاء</button>
                                                    <button onclick="submitActivityDay()" class="flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 shadow-lg">تأكيد الرصد</button>
                                                </div>
                                            </div>
                                        </div>

                                        <div id="activity-absent-modal" class="fixed inset-0 bg-black/60 z-[130] hidden flex items-center justify-center p-4 backdrop-blur-sm">
                                            <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl flex flex-col">
                                                <div class="text-center mb-6">
                                                    <div class="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                                                        <i data-lucide="check-circle" class="w-8 h-8"></i>
                                                    </div>
                                                    <h3 class="font-bold text-lg">تم رصد يوم النشاط!</h3>
                                                    <p class="text-sm text-gray-500">تم تسجيل الغياب، يمكنك مراسلة أولياء الأمور:</p>
                                                </div>
                                                <div id="activity-absent-whatsapp-list" class="space-y-3 mb-6"></div>
                                                <button onclick="closeModal('activity-absent-modal')" class="w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 rounded-xl font-bold">إغلاق</button>
                                            </div>
                                        </div>
                                        `;
}

// --- Password Modal Logic ---
let passwordResolver = null;

function requestPassword(message) {
    return new Promise((resolve) => {
        $('#password-modal-msg').textContent = message || "يرجى إدخال كلمة المرور للمتابعة";
        $('#modal-password-input').value = "";
        passwordResolver = resolve;
        toggleModal('password-modal', true);
        setTimeout(() => $('#modal-password-input').focus(), 100);
    });
}

function submitPasswordModal() {
    const val = $('#modal-password-input').value;
    if (passwordResolver) passwordResolver(val);
    toggleModal('password-modal', false);
}

function resolvePasswordModal(val) {
    if (passwordResolver) passwordResolver(val);
    toggleModal('password-modal', false);
}

// --- Data Operations (Refs to modals) ---

// === STUDENTS ===
function openAddStudentModal() {
    $('#student-id').value = '';
    $('#student-form').reset();
    $('#student-modal-title').textContent = 'إضافة طالب جديد';
    $('#save-student-text').textContent = 'حفظ';
    toggleModal('student-modal', true);
}

async function openEditStudent(id) {
    const student = state.students.find(s => s.id === id);
    if (!student) return;

    // إذا كان طالباً، يجب التحقق من كلمة المرور أولاً
    if (!state.isTeacher) {
        const msg = student.password ? 'أدخل كلمة المرور الخاصة بك:' : 'أدخل كلمة مرور المرحلة لتعديل بياناتك:';
        const enteredPass = await requestPassword(msg);
        if (!enteredPass) return;

        const studentPass = student.password;
        const levelPass = (LEVELS[state.currentLevel] ? LEVELS[state.currentLevel].studentPass : '');

        let isValid = false;
        if (studentPass) {
            if (enteredPass === studentPass) isValid = true;
        } else {
            if (enteredPass === levelPass) isValid = true;
        }

        if (!isValid) {
            showToast('كلمة المرور غير صحيحة', 'error');
            return;
        }
    }

    $('#student-id').value = student.id;
    $('#student-name').value = student.name;
    $('#student-number').value = student.studentNumber || '';
    $('#student-memorization').value = student.memorizationPlan || '';
    $('#student-review').value = student.reviewPlan || '';
    $('#student-emoji').value = student.icon || '👤';
    $('#student-password-edit').value = student.password || '';

    // إعداد حالة القراءة فقط للطالب
    const isTeacher = state.isTeacher;
    $('#student-number').disabled = !isTeacher;
    $('#student-memorization').disabled = !isTeacher;
    $('#student-review').disabled = !isTeacher;
    $('#student-password-edit').disabled = !isTeacher;

    // الاسم والصورة مسموح بتعديلهم

    // عرض الصورة/الإيموجي الحالي
    const preview = $('#student-emoji-preview');
    if (student.icon && student.icon.startsWith('data:image')) {
        preview.innerHTML = `<img src="${student.icon}" class="w-full h-full object-cover">`;
    } else {
        preview.innerHTML = student.icon || '👤';
    }

    $('#student-modal-title').textContent = 'تعديل بيانات الطالب';
    $('#save-student-text').textContent = 'تحديث';
    toggleModal('student-modal', true);
}

let studentToDeleteId = null;
function confirmDeleteStudent(id) {
    studentToDeleteId = id;
    toggleModal('delete-modal', true);
    // Bind verify
    $('#confirm-delete-btn').onclick = performDeleteStudent;
}

async function performDeleteStudent() {
    if (!studentToDeleteId) return;
    try {
        await window.firebaseOps.deleteDoc(window.firebaseOps.doc(window.db, "students", studentToDeleteId));
        showToast("تم الحذف");
        closeModal('delete-modal');
    } catch (err) { console.error(err); showToast("خطأ في الحذف", "error"); }
}

// === GROUPS ===
// Assuming groups are sub-collections or root collections with competitionId?
// For simplicity in this flat structure, let's say groups are root but have 'competitionId'.

let currentManageCompId = null;

function openManageGroups(compId, compName) {
    currentManageCompId = compId;
    $('#groups-comp-name').textContent = compName;

    // إظهار زر إضافة مجموعة للمعلم فقط
    const addBtn = $('#add-group-btn');
    if (addBtn) {
        if (state.isTeacher) {
            addBtn.classList.remove('hidden');
        } else {
            addBtn.classList.add('hidden');
        }
    }

    toggleModal('groups-modal', true);
    fetchGroupsForCompetition(compId);
}

function fetchGroupsForCompetition(compId) {
    const container = $('#groups-container');
    container.innerHTML = '<div class="text-center p-4"><i data-lucide="loader-2" class="animate-spin w-6 h-6 mx-auto"></i></div>';

    const q = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "groups"),
        window.firebaseOps.where("competitionId", "==", compId)
    );

    // Realtime listener for groups modal? Or just getDocs? 
    // getDocs is safer for modal to avoid lingering listeners.
    window.firebaseOps.getDocs(q).then(snap => {
        if (snap.empty) {
            container.innerHTML = '<p class="text-center text-gray-400">لا توجد مجموعات</p>';
            return;
        }
        state.groups = [];
        const html = [];
        snap.forEach(doc => {
            var g = doc.data();
            g.id = doc.id;
            state.groups.push(g);
            const isImg = g.icon && g.icon.startsWith('data:image');
            const iconHtml = isImg
                ? `<img src="${g.icon}" class="w-full h-full object-cover">`
                : (g.icon || '🛡️');

            html.push(`
                                            <div class="bg-gray-50 dark:bg-gray-700/50 rounded-xl border shadow-sm overflow-hidden">
                                                <div onclick="viewGroupStudents('${g.id}')" class="flex items-center gap-3 p-3 cursor-pointer hover:bg-white dark:hover:bg-gray-700 transition">
                                                    <div class="w-10 h-10 bg-white dark:bg-gray-600 rounded-lg flex items-center justify-center text-xl border overflow-hidden shadow-sm">
                                                        ${iconHtml}
                                                    </div>
                                                    <div class="flex-1">
                                                        <h4 class="font-bold text-gray-800 dark:text-gray-100">${g.name}</h4>
                                                        <div class="flex gap-2 text-xs text-gray-500">
                                                            <span>${(g.members ? g.members.length : 0)} أعضاء</span>
                                                            ${g.leader ? '<span class="text-amber-500 font-bold">👑</span>' : ''}
                                                        </div>
                                                    </div>
                                                    <i data-lucide="chevron-left" class="w-4 h-4 text-gray-400"></i>
                                                </div>
                                                ${state.isTeacher ? `
                    <div class="border-t flex divide-x dark:divide-gray-600">
                        <button onclick="event.stopPropagation(); openEditGroup('${g.id}')" class="flex-1 text-teal-600 dark:text-teal-400 font-bold text-sm py-2 hover:bg-teal-50 dark:hover:bg-teal-900/30 transition">
                            <i data-lucide="edit-2" class="w-3 h-3 inline"></i> تعديل
                        </button>
                        <button onclick="event.stopPropagation(); deleteGroup('${g.id}')" class="flex-1 text-red-600 dark:text-red-400 font-bold text-sm py-2 hover:bg-red-50 dark:hover:bg-red-900/30 transition">
                            <i data-lucide="trash-2" class="w-3 h-3 inline"></i> حذف
                        </button>
                    </div>
                    ` : ''}
                                            </div>
                                            `);
        });
        container.innerHTML = html.join('');
        lucide.createIcons();
    });
}

async function viewGroupStudents(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) {
        showToast("المجموعة غير موجودة", "error");
        return;
    }

    const container = $('#groups-container');
    container.innerHTML = '<div class="text-center p-4"><i data-lucide="loader-2" class="animate-spin w-6 h-6 mx-auto"></i></div>';
    lucide.createIcons();

    const memberIds = group.members || [];
    const groupStudents = state.students.filter(s => memberIds.includes(s.id));

    // Fetch scores for this group's students in this competition
    let studentScores = {};
    try {
        const scoresQ = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "scores"),
            window.firebaseOps.where("competitionId", "==", currentManageCompId)
        );
        const scoresSnap = await window.firebaseOps.getDocs(scoresQ);
        scoresSnap.forEach(doc => {
            const s = doc.data();
            if (memberIds.includes(s.studentId)) {
                studentScores[s.studentId] = (studentScores[s.studentId] || 0) + (s.points || 0);
            }
        });
    } catch (e) { console.error("Error fetching scores:", e); }

    let html = `
                                            <div class="mb-4">
                                                <button onclick="fetchGroupsForCompetition('${currentManageCompId}')" class="text-teal-600 font-bold text-sm flex items-center gap-1">
                                                    <i data-lucide="arrow-right" class="w-4 h-4"></i>
                                                    العودة للمجموعات
                                                </button>
                                                <h4 class="font-bold text-lg mt-2">${group.name}</h4>
                                            </div>
                                            <div class="space-y-2">
                                                `;

    if (groupStudents.length === 0) {
        html += '<p class="text-center text-gray-400 py-4">لا يوجد طلاب في هذه المجموعة</p>';
    } else {
        groupStudents.forEach(s => {
            const isImg = s.icon && s.icon.startsWith('data:image');
            const iconHtml = isImg ? `<img src="${s.icon}" class="w-full h-full object-cover rounded-full">` : (s.icon || '👤');
            const score = studentScores[s.id] || 0;
            const isLeader = group.leader === s.id;
            const isDeputy = group.deputy === s.id;

            html += `
                <div class="flex items-center justify-between p-3 bg-white dark:bg-gray-700 rounded-xl border shadow-sm">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden border">
                            ${iconHtml}
                        </div>
                        <div>
                            <h4 class="font-bold text-sm flex items-center gap-1">
                                ${s.name}
                                ${isLeader ? '<span class="text-amber-500">👑</span>' : ''}
                                ${isDeputy ? '<span class="text-blue-500">⭐</span>' : ''}
                            </h4>
                            <p class="text-xs text-gray-500">${s.studentNumber || ''}</p>
                        </div>
                    </div>
                    <div class="text-center">
                        <span class="text-lg font-bold ${score >= 0 ? 'text-green-600' : 'text-red-600'}">${score}</span>
                        <p class="text-xs text-gray-400">نقطة</p>
                    </div>
                </div>
            `;
        });
    }

    // Group total
    const groupTotal = Object.values(studentScores).reduce((a, b) => a + b, 0);
    html += `
                                            </div>
                                            </div>
                                            <div class="mt-4 p-3 bg-teal-50 dark:bg-teal-900/30 rounded-xl flex items-center justify-between">
                                                <div>
                                                    <span class="text-sm text-teal-700 dark:text-teal-300 block">مجموع نقاط المجموعة:</span>
                                                    <span class="text-2xl font-bold text-teal-600 dark:text-teal-400">${groupTotal}</span>
                                                </div>
                                                ${state.isTeacher ? `
                                                <button onclick="generateGroupWeeklyReport('${group.id}')" class="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg hover:bg-teal-700 transition flex items-center gap-2">
                                                    <i data-lucide="bar-chart-2" class="w-4 h-4"></i>
                                                    تقرير الأسبوع
                                                </button>
                                                ` : ''}
                                            </div>
                                            `;

    container.innerHTML = html;
    lucide.createIcons();
}

async function generateGroupWeeklyReport(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;

    const comp = state.competitions.find(c => c.id === currentManageCompId);
    if (!comp) return; // Should not happen if inside viewGroup

    showToast("جاري إعداد التقرير...", "info");

    try {
        // 1. Calculate Date Range (Sun - Thu)
        const today = new Date();
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - dayOfWeek);
        startOfWeek.setHours(0, 0, 0, 0);

        const daysPassed = 5; // Fixed for full week report
        const dateStrings = [];
        for (let i = 0; i < daysPassed; i++) {
            const d = new Date(startOfWeek);
            d.setDate(startOfWeek.getDate() + i);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            dateStrings.push(`${year}-${month}-${day}`);
        }

        // 2. Fetch Scores for all members
        const memberIds = group.members || [];
        if (memberIds.length === 0) {
            showToast("المجموعة فارغة", "error");
            return;
        }

        const scoresQuery = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "scores"),
            window.firebaseOps.where("competitionId", "==", comp.id),
            // We can't use 'in' for both studentId (array) and date (array) usually.
            // Better to fetch all scores for this competition/date and filter by memberIds client-side
            window.firebaseOps.where("date", "in", dateStrings)
        );

        const snap = await window.firebaseOps.getDocs(scoresQuery);
        const scores = [];
        snap.forEach(d => {
            const data = d.data();
            if (memberIds.includes(data.studentId)) {
                scores.push(data);
            }
        });

        // NEW: Fetch Activity Days Log
        const activityQuery = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "activity_days"),
            window.firebaseOps.where("competitionId", "==", comp.id),
            window.firebaseOps.where("date", "in", dateStrings)
        );
        const activitySnap = await window.firebaseOps.getDocs(activityQuery);
        const activityLog = {}; // date -> points
        activitySnap.forEach(d => {
            const data = d.data();
            activityLog[data.date] = data.points;
        });

        // 3. Calculate Stats
        let totalPositiveEarned = 0;
        let totalAbsenceDeduction = 0;
        let absenceCount = 0;
        let activityDaysTaken = 0;

        scores.forEach(s => {
            const p = parseInt(s.points) || 0;
            if (s.criteriaId === 'ABSENCE_RECORD') {
                totalAbsenceDeduction += p; // p is negative
                absenceCount++;
            } else {
                if (p > 0) totalPositiveEarned += p;
                else totalAbsenceDeduction += p; // Negative criteria also deducted
            }
        });

        // Calculate Possible Points (Original)
        let dailyStandardPossible = 0;
        if (comp.criteria) {
            comp.criteria.forEach(c => {
                dailyStandardPossible += (parseInt(c.positivePoints) || 0);
            });
        }

        let totalPossible = 0;
        dateStrings.forEach(dateStr => {
            if (activityLog[dateStr]) {
                // This was an Activity Day
                totalPossible += activityLog[dateStr] * memberIds.length;
                activityDaysTaken++;
            } else {
                // Normal Day
                totalPossible += dailyStandardPossible * memberIds.length;
            }
        });

        const netTotal = totalPositiveEarned + totalAbsenceDeduction;

        // 4. Construct Message
        let reportText = `📊 *تقرير الأسبوع (مجموعة ${group.name})* 📊\n`;
        reportText += `📅 التاريخ: ${dateStrings[0]} إلى ${dateStrings[4]}\n`;
        reportText += `👥 عدد الطلاب: ${memberIds.length}\n`;
        if (activityDaysTaken > 0) {
            reportText += `🎪 تم إقامة نشاط في هذا الأسبوع\n`;
        }
        reportText += `------------------\n`;

        reportText += `🎯 النقاط المستحقة (الأصلية): ${totalPossible}\n`;
        reportText += `✅ النقاط المكتسبة: ${totalPositiveEarned}\n`;

        if (absenceCount > 0) {
            reportText += `⚠️ الغياب: ${absenceCount} حالة (${totalAbsenceDeduction} نقطة)\n`;
        }

        // If we had bonus logic: reportText += `➕ نقاط إضافية: ${addedPoints}\n`;

        reportText += `------------------\n`;
        reportText += `✨ *المجموع الصافي: ${netTotal}* ✨\n`;

        reportText += `\nشاكرين جهودكم 🌹`;

        // 5. Open WhatsApp (Generic)
        const url = `https://wa.me/?text=${encodeURIComponent(reportText)}`;
        window.open(url, '_blank');

    } catch (e) {
        console.error(e);
        showToast("خطأ في إنشاء التقرير", "error");
    }
}

function addNewGroup() {
    if (!currentManageCompId) {
        showToast("يجب اختيار مسابقة أولاً", "error");
        return;
    }
    openAddGroupModal();
}

// فتح نافذة إضافة مجموعة جديدة
function openAddGroupModal() {
    if (!currentManageCompId) {
        showToast("يجب اختيار مسابقة أولاً", "error");
        return;
    }

    // إعادة تعيين النموذج
    $('#edit-group-id').value = '';
    $('#edit-group-name').value = '';
    $('#group-icon').value = '🛡️';
    $('#group-icon-preview').innerHTML = '🛡️';
    $('#group-modal-title').textContent = 'إضافة مجموعة جديدة';

    // تعبئة قوائم الطلاب
    populateGroupStudentLists();
    renderGroupMembersSelect([], null, null);

    toggleModal('edit-group-modal', true);
    lucide.createIcons();
}

// تعبئة قوائم اختيار الطلاب (القائد والنائب)
function populateGroupStudentLists() {
    const leaderSelect = $('#group-leader');
    const deputySelect = $('#group-deputy');

    if (!leaderSelect || !deputySelect) return;

    const options = '<option value="">-- اختر --</option>' +
        state.students.map(s => `<option value="${s.id}" > ${s.name}</option>`).join('');

    leaderSelect.innerHTML = options;
    deputySelect.innerHTML = options;
}

function openEditGroup(groupId) {
    if (!state.isTeacher) {
        showToast("عذراً، هذا الإجراء متاح للمعلم فقط", "error");
        return;
    }

    if (!groupId) {
        openAddGroupModal();
        return;
    }

    $('#edit-group-id').value = groupId;
    $('#group-modal-title').textContent = 'تعديل المجموعة';

    // تعبئة قوائم الطلاب
    populateGroupStudentLists();

    // جلب بيانات المجموعة
    window.firebaseOps.getDoc(window.firebaseOps.doc(window.db, "groups", groupId)).then(snap => {
        if (snap.exists()) {
            const d = snap.data();
            $('#edit-group-name').value = d.name || '';
            $('#group-leader').value = d.leader || '';
            $('#group-deputy').value = d.deputy || '';
            $('#group-icon').value = d.icon || '🛡️';

            // عرض الأيقونة
            const preview = $('#group-icon-preview');
            if (d.icon && d.icon.startsWith('data:image')) {
                preview.innerHTML = `<img src = "${d.icon}" class="w-full h-full object-cover">`;
            } else {
                preview.innerHTML = d.icon || '🛡️';
            }

            renderGroupMembersSelect(d.members || [], d.leader, d.deputy);
        }
    }).catch(err => {
        console.error(err);
        showToast("خطأ في تحميل بيانات المجموعة", "error");
    });

    toggleModal('edit-group-modal', true);
    lucide.createIcons();
}

async function previewGroupImage(input) {
    if (input.files && input.files[0]) {
        const compressed = await compressImage(input.files[0]);
        const preview = document.getElementById('group-icon-preview');
        preview.innerHTML = `<img src="${compressed}" class="w-full h-full object-cover">`;
        document.getElementById('group-icon').value = compressed;
    }
}

// دورة الإيموجي للمجموعات
const groupEmojis = ["🛡️", "⚔️", "🏆", "🌟", "🦁", "🐯", "🦅", "🐎", "🔥", "💎", "👑", "⭐", "🚀", "💪", "🎯"];
let groupEmojiIndex = 0;

function cycleGroupEmoji() {
    groupEmojiIndex = (groupEmojiIndex + 1) % groupEmojis.length;
    const emoji = groupEmojis[groupEmojiIndex];
    document.getElementById('group-icon').value = emoji;
    document.getElementById('group-icon-preview').innerHTML = emoji;
}

function renderGroupMembersSelect(selectedIds, leaderId, deputyId) {
    const list = $('#group-members-selection');
    if (!list) return;

    if (state.students.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm py-2">لا يوجد طلاب</p>';
        return;
    }

    list.innerHTML = state.students.map(s => {
        const isSelected = selectedIds.includes(s.id);
        const isLeaderOrDeputy = s.id === leaderId || s.id === deputyId;
        return `
                                                <label class="flex items-center gap-2 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 rounded cursor-pointer ${isLeaderOrDeputy ? 'opacity-50' : ''}" >
                                                    <input type="checkbox" value="${s.id}" class="group-member-checkbox w-4 h-4 text-teal-600 rounded" ${isSelected ? 'checked' : ''} ${isLeaderOrDeputy ? 'disabled' : ''}>
                                                        <span class="text-sm">${s.name}</span>
                                                        ${isLeaderOrDeputy ? '<span class="text-xs text-gray-400">(قائد/نائب)</span>' : ''}
                                                </label>
                                                `;
    }).join('');
}

async function saveGroupChanges() {
    const id = $('#edit-group-id').value;
    const name = $('#edit-group-name').value;
    const leader = $('#group-leader').value;
    const deputy = $('#group-deputy').value;
    const icon = $('#group-icon').value;
    const members = Array.from($$('.group-member-checkbox:checked')).map(cb => cb.value);

    // إضافة القائد والنائب للأعضاء إذا لم يكونوا موجودين
    if (leader && !members.includes(leader)) members.push(leader);
    if (deputy && !members.includes(deputy)) members.push(deputy);

    if (!name) { showToast("اسم المجموعة مطلوب", "error"); return; }

    // Check if any student is already in another group for this competition
    try {
        const groupsQ = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "groups"),
            window.firebaseOps.where("competitionId", "==", currentManageCompId)
        );
        const groupsSnap = await window.firebaseOps.getDocs(groupsQ);

        const existingMembers = new Set();
        groupsSnap.forEach(doc => {
            if (doc.id !== id) { // Ignore current group if editing
                const gData = doc.data();
                if (gData.members && Array.isArray(gData.members)) {
                    gData.members.forEach(m => existingMembers.add(m));
                }
            }
        });

        const duplicates = members.filter(m => existingMembers.has(m));
        if (duplicates.length > 0) {
            const dupNames = state.students.filter(s => duplicates.includes(s.id)).map(s => s.name).join(', ');
            showToast(`طلاب مسجلون في مجموعات أخرى: ${dupNames}`, "error");
            return;
        }

    } catch (e) {
        console.error("Error checking group duplicates", e);
        showToast("خطأ في التحقق من الأعضاء", "error");
        return;
    }

    const data = {
        name,
        icon,
        leader,
        deputy,
        competitionId: currentManageCompId,
        members,
        level: state.currentLevel,
        updatedAt: new Date()
    };

    try {
        if (id) {
            await window.firebaseOps.updateDoc(window.firebaseOps.doc(window.db, "groups", id), data);
            showToast("تم تحديث المجموعة");
        } else {
            await window.firebaseOps.addDoc(window.firebaseOps.collection(window.db, "groups"), data);
            showToast("تم إضافة المجموعة");
        }
        closeModal('edit-group-modal');
        fetchGroupsForCompetition(currentManageCompId);
    } catch (err) {
        console.error(err);
        showToast("خطأ في حفظ المجموعة", "error");
    }
}

// === GRADING SYSTEM ===
let currentGradingCompId = null;
let currentGradingGroupId = null;
let currentRateStudentId = null;

function openGradingSession(compId, keepDate = false) {
    if (!state.isTeacher) {
        showToast("عذراً، الرصد متاح للمعلم فقط", "error");
        return;
    }

    currentGradingCompId = compId;
    currentGradingGroupId = null;

    // Set default date to today and MAX to today ONLY if not set
    const dateInput = $('#grading-date');
    const today = new Date().toISOString().split('T')[0];
    if (dateInput) {
        if (!keepDate) {
            // Reset to today ONLY on fresh open, not on refresh
            dateInput.value = today;
        }
        dateInput.max = today;
    }

    // Fetch groups for this competition
    const container = $('#grading-students-list');
    container.innerHTML = '<div class="text-center py-8"><i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto"></i></div>';

    toggleModal('grading-modal', true);
    lucide.createIcons();

    // Fetch groups
    const q = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "groups"),
        window.firebaseOps.where("competitionId", "==", compId)
    );

    window.firebaseOps.getDocs(q).then(snap => {
        if (snap.empty) {
            container.innerHTML = '<p class="text-center text-gray-400 py-8">لا توجد مجموعات. أضف مجموعات أولاً من قائمة المسابقات.</p>';
            return;
        }

        let html = '<div class="space-y-3">';
        snap.forEach(doc => {
            var g = doc.data();
            g.id = doc.id;
            const iconHtml = (g.icon && g.icon.startsWith('data:image'))
                ? `<img src="${g.icon}" class="w-full h-full object-cover">`
                : (g.icon || '🛡️');

            html += `
            <div onclick="openGroupGrading('${g.id}')" class="flex items-center gap-3 p-3 bg-white dark:bg-gray-700/50 rounded-xl border shadow-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600 transition">
                <div class="w-10 h-10 bg-gray-100 dark:bg-gray-600 rounded-lg flex items-center justify-center text-xl border overflow-hidden shadow-sm">
                    ${iconHtml}
                </div>
                <div class="flex-1">
                    <h4 class="font-bold text-gray-800 dark:text-gray-100">${g.name}</h4>
                    <p class="text-xs text-gray-500">${(g.members ? g.members.length : 0)} أعضاء</p>
                </div>
                <i data-lucide="chevron-left" class="w-4 h-4 text-gray-400"></i>
            </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
        lucide.createIcons();
    });
}

function openGroupGrading(groupId) {
    currentGradingGroupId = groupId;

    const container = $('#grading-students-list');
    container.innerHTML = '<div class="text-center py-8"><i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto"></i></div>';
    lucide.createIcons();

    // Fetch group data
    window.firebaseOps.getDoc(window.firebaseOps.doc(window.db, "groups", groupId)).then(async snap => {
        if (!snap.exists()) {
            container.innerHTML = '<p class="text-center text-red-400">المجموعة غير موجودة</p>';
            return;
        }

        const group = snap.data();
        const memberIds = group.members || [];

        if (memberIds.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4">
                    <button onclick="openGradingSession('${currentGradingCompId}')" class="text-teal-600 font-bold text-sm mb-4">← العودة للمجموعات</button>
                    <p class="text-gray-400">لا يوجد طلاب في هذه المجموعة</p>
                </div>`;
            return;
        }

        // Fetch students from Firebase directly (fix for empty state.students)
        let groupStudents = state.students.filter(s => memberIds.includes(s.id));

        // If state.students is empty, fetch from Firebase
        if (groupStudents.length === 0 && memberIds.length > 0) {
            try {
                const studentsSnap = await window.firebaseOps.getDocs(
                    window.firebaseOps.query(
                        window.firebaseOps.collection(window.db, "students"),
                        window.firebaseOps.where("level", "==", state.currentLevel)
                    )
                );
                const fetchedStudents = [];
                studentsSnap.forEach(function (doc) {
                    var data = doc.data();
                    data.id = doc.id;
                    fetchedStudents.push(data);
                });
                state.students = fetchedStudents; // Update state for future use
                groupStudents = fetchedStudents.filter(s => memberIds.includes(s.id));
            } catch (e) {
                console.error("Error fetching students:", e);
            }
        }

        if (groupStudents.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4">
                    <button onclick="openGradingSession('${currentGradingCompId}')" class="text-teal-600 font-bold text-sm mb-4">← العودة للمجموعات</button>
                    <p class="text-gray-400">لا يوجد طلاب في هذه المجموعة</p>
                </div>`;
            return;
        }

        let html = `
                                                <div class="sticky top-0 bg-white dark:bg-gray-800 py-2 mb-3 border-b flex justify-between items-center">
                                                    <div>
                                                        <button onclick="openGradingSession('${currentGradingCompId}')" class="text-teal-600 font-bold text-sm flex items-center gap-1">
                                                            <i data-lucide="arrow-right" class="w-4 h-4"></i>
                                                            العودة
                                                        </button>
                                                        <h4 class="font-bold mt-1">${group.name}</h4>
                                                    </div>
                                                    <button onclick="openActivityCheckModal('${groupId}')" class="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow hover:bg-purple-700 transition flex items-center gap-1">
                                                        <i data-lucide="zap" class="w-3 h-3"></i>
                                                        يوم نشاط
                                                    </button>
                                                </div>
                                                <div class="space-y-2">
                                                    `;

        groupStudents.forEach(s => {
            const isImg = s.icon && s.icon.startsWith('data:image');
            const iconHtml = isImg ? `<img src="${s.icon}" class="w-full h-full object-cover rounded-full">` : (s.icon || '👤');

            html += `
                                                        <div onclick="openRateStudent('${s.id}')" class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-xl cursor-pointer hover:bg-gray-100 transition">
                                                            <div class="flex items-center gap-3">
                                                                <div class="w-10 h-10 bg-white rounded-full flex items-center justify-center border overflow-hidden">${iconHtml}</div>
                                                                <div>
                                                                    <h4 class="font-bold text-sm">${s.name}</h4>
                                                                    <p class="text-xs text-gray-500">${s.studentNumber || ''}</p>
                                                                </div>
                                                            </div>
                                                            <i data-lucide="chevron-left" class="text-gray-400"></i>
                                                        </div>
                                                        `;
        });

        html += '</div>';
        container.innerHTML = html;
        lucide.createIcons();
    });
}

function refreshGradingStatus() {
    if (currentGradingGroupId) {
        openGroupGrading(currentGradingGroupId);
    } else {
        openGradingSession(currentGradingCompId, true); // Keep Date!
    }
}

function filterGradingList(val) {
    // For simplicity, re-render with filter (could be optimized)
    refreshGradingStatus();
}

function openRateStudent(studentId) {
    currentRateStudentId = studentId;
    const s = state.students.find(x => x.id === studentId);
    $('#rate-student-name').textContent = s ? s.name : 'تقييم الطالب';

    // عرض التاريخ
    const dateVal = $('#grading-date').value;
    $('#rate-date-display').textContent = `تاريخ الرصد: ${dateVal}`;

    // Get Competition Criteria
    const comp = state.competitions.find(c => c.id === currentGradingCompId);
    if (!comp || !comp.criteria) {
        showToast("لا توجد معايير لهذه المسابقة", "error");
        return;
    }

    const grid = $('#criteria-buttons-grid');
    grid.innerHTML = comp.criteria.map(c => `
                                                <div class="flex items-center gap-2">
                                                    <button onclick="submitScore('${c.id}', ${c.positivePoints}, '${c.name}', 'positive')" class="flex-1 bg-green-50 text-green-700 border border-green-200 py-3 rounded-xl font-bold hover:bg-green-100 transition flex justify-between px-4">
                                                        <span>${c.name} (+${c.positivePoints})</span>
                                                        <i data-lucide="thumbs-up" class="w-4 h-4"></i>
                                                    </button>
                                                    ${c.negativePoints ? `
            <button onclick="submitScore('${c.id}', -${c.negativePoints}, '${c.name}', 'negative')" class="w-20 bg-red-50 text-red-700 border border-red-200 py-3 rounded-xl font-bold hover:bg-red-100 transition flex justify-center">
                <span>-${c.negativePoints}</span>
            </button>
            ` : ''}
                                                </div>
                                                `).join('');

    // زر الغياب الإضافي + زر التقرير الأسبوعي
    grid.innerHTML += `
        <div class="col-span-1 mt-4 grid grid-cols-2 gap-3 w-full">
            <button onclick="openAbsenceOptions()" class="bg-orange-50 text-orange-700 border border-orange-200 py-3 rounded-xl font-bold hover:bg-orange-100 transition flex items-center justify-center gap-2">
                <i data-lucide="user-x" class="w-4 h-4"></i>
                <span>تسجيل غياب</span>
            </button>
             <button onclick="generateWeeklyReport()" class="bg-blue-50 text-blue-700 border border-blue-200 py-3 rounded-xl font-bold hover:bg-blue-100 transition flex items-center justify-center gap-2">
                <i data-lucide="file-text" class="w-4 h-4"></i>
                <span>تقرير أسبوعي</span>
            </button>
        </div>
    `;

    toggleModal('rate-student-modal', true);
    lucide.createIcons();
}

async function submitScore(criteriaId, points, criteriaName, type) {
    if (!currentRateStudentId || !currentGradingCompId) return;

    // Get selected date
    const dateVal = $('#grading-date').value;
    if (!dateVal) {
        showToast("يرجى اختيار التاريخ", "error");
        return;
    }

    const data = {
        studentId: currentRateStudentId,
        competitionId: currentGradingCompId,
        groupId: currentGradingGroupId,
        criteriaId,
        criteriaName,
        points: parseInt(points),
        type, // 'positive' or 'negative'
        level: state.currentLevel,
        date: dateVal, // Store YYYY-MM-DD
        updatedAt: new Date(),
        timestamp: Date.now()
    };

    try {
        // Check for existing score to Update
        const duplicateQ = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "scores"),
            window.firebaseOps.where("studentId", "==", currentRateStudentId),
            window.firebaseOps.where("date", "==", dateVal),
            window.firebaseOps.where("criteriaId", "==", criteriaId) // Need strict match
        );

        // Note: Composite index might be needed. If fails, we might need client-side filtering again.
        // But for update, we really need the ID.
        // Let's try to query by student+date (which likely has index or small enough result set) 
        // and find the doc client-side to save writes/queries complexity if index missing.

        const q = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "scores"),
            window.firebaseOps.where("studentId", "==", currentRateStudentId),
            window.firebaseOps.where("date", "==", dateVal)
        );

        const snap = await window.firebaseOps.getDocs(q);
        const existingDoc = snap.docs.find(d => d.data().criteriaId === criteriaId);

        if (existingDoc) {
            // Update
            await window.firebaseOps.updateDoc(window.firebaseOps.doc(window.db, "scores", existingDoc.id), data);
            showToast(`تم تعديل الدرجة إلى ${points}`, "success");
        } else {
            // Create
            data.createdAt = new Date();
            await window.firebaseOps.addDoc(window.firebaseOps.collection(window.db, "scores"), data);
            showToast(`تم رصد ${points > 0 ? '+' : ''}${points} نقطة`, points > 0 ? "success" : "error");
        }
        // closeModal('rate-student-modal'); // Keep open
    } catch (e) {
        console.error(e);
        // Fallback if query fails (e.g. index issue), try adding blindly? No, unsafe. 
        // Just show error.
        showToast("خطأ في الرصد Check Console", "error");
    }
}

// Student Edit Security Check
let currentActivityGroupId = null;

async function openActivityCheckModal(groupId) {
    currentActivityGroupId = groupId;
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;

    const list = $('#activity-students-list');
    list.innerHTML = `<div class="p-4 text-center"><i data-lucide="loader-2" class="animate-spin w-5 h-5 mx-auto"></i></div>`;
    lucide.createIcons();

    // Fetch group members if not in state
    let members = state.students.filter(s => group.members.includes(s.id));
    if (members.length === 0) {
        // Fallback fetch - already handled in openGroupGrading but just in case
        const q = window.firebaseOps.query(window.firebaseOps.collection(window.db, "students"), window.firebaseOps.where("level", "==", state.currentLevel));
        const snap = await window.firebaseOps.getDocs(q);
        const all = []; snap.forEach(d => { var x = d.data(); x.id = d.id; all.push(x); });
        state.students = all;
        members = all.filter(s => group.members.includes(s.id));
    }

    list.innerHTML = members.map(s => `
        <label class="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition">
            <span class="font-bold text-sm">${s.name}</span>
            <input type="checkbox" value="${s.id}" class="activity-absent-checkbox w-5 h-5 text-purple-600 rounded-lg border-gray-300">
        </label>
    `).join('');

    toggleModal('activity-check-modal', true);
}

async function submitActivityDay() {
    const comp = state.competitions.find(c => c.id === currentGradingCompId);
    const group = state.groups.find(g => g.id === currentActivityGroupId);
    const dateVal = $('#grading-date').value;

    if (!comp || !group || !dateVal) {
        showToast("خطأ في البيانات أو التاريخ", "error");
        return;
    }

    const activityPoints = comp.activityPoints || 0;
    const rawActivityAbsentPoints = comp.activityAbsentPoints || 0;
    // Force negative for deduction consistency
    const activityAbsentPoints = rawActivityAbsentPoints > 0 ? -rawActivityAbsentPoints : rawActivityAbsentPoints;
    const absents = Array.from($$('.activity-absent-checkbox:checked')).map(cb => cb.value);
    const members = group.members || [];

    const confirmBtn = $$('#activity-check-modal button')[1];
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin w-4 h-4 mx-auto"></i>';
        lucide.createIcons();
    }

    try {
        // 0. Check if Activity Day already exists for this date and competition
        const duplicateCheckQ = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "activity_days"),
            window.firebaseOps.where("competitionId", "==", comp.id),
            window.firebaseOps.where("date", "==", dateVal)
        );
        const duplicateCheckSnap = await window.firebaseOps.getDocs(duplicateCheckQ);
        if (!duplicateCheckSnap.empty) {
            showToast("تم تسجيل نشاط لهذا اليوم مسبقاً في هذه المسابقة", "error");
            return;
        }

        // 1. Log the Activity Day
        await window.firebaseOps.addDoc(window.firebaseOps.collection(window.db, "activity_days"), {
            competitionId: comp.id,
            date: dateVal,
            points: activityPoints
        });

        // 2. Save Scores using Sequential Batch for stability
        const batch = window.firebaseOps.writeBatch(window.db);

        members.forEach(sid => {
            const isAbsent = absents.includes(sid);
            const scoreData = {
                studentId: sid,
                competitionId: comp.id,
                groupId: group.id,
                criteriaId: isAbsent ? 'ABSENCE_RECORD' : 'ACTIVITY_DAY',
                criteriaName: isAbsent ? 'غياب يوم نشاط' : 'حضور يوم نشاط',
                points: isAbsent ? activityAbsentPoints : activityPoints,
                type: isAbsent ? 'absence' : 'activity',
                level: state.currentLevel,
                date: dateVal,
                updatedAt: new Date(),
                timestamp: Date.now(),
                createdAt: new Date()
            };

            // Note: writeBatch.set in our wrapper always does addDoc
            batch.set(window.firebaseOps.doc(window.db, "scores", "temp_" + sid), scoreData);
        });

        await batch.commit();

        closeModal('activity-check-modal');
        showToast("تم رصد درجات النشاط بنجاح", "success");

        // 3. Show WhatsApp list for absentees
        const absentStudents = state.students.filter(s => absents.includes(s.id));
        if (absentStudents.length > 0) {
            const waList = $('#activity-absent-whatsapp-list');
            waList.innerHTML = absentStudents.map(s => {
                const phone = s.studentNumber || '';
                const msg = `نحيطكم علماً بغياب الطالب (${s.name}) عن يوم النشاط المقام اليوم في مسابقة ${comp.name}.`;
                const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;

                return `
                    <div class="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30">
                        <span class="font-bold text-sm text-gray-800 dark:text-gray-200">${s.name}</span>
                        ${phone ? `
                        <a href="${url}" target="_blank" class="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 hover:bg-green-700 transition">
                            <i data-lucide="message-circle" class="w-3 h-3"></i>
                            مراسلة
                        </a>
                        ` : '<span class="text-[10px] text-gray-400">لا يوجد رقم</span>'}
                    </div>
                `;
            }).join('');

            toggleModal('activity-absent-modal', true);
            lucide.createIcons();
        }

    } catch (e) {
        console.error("submitActivityDay error full:", e);
        const errorMsg = e.message || "حدث خطأ في الاتصال بقاعدة البيانات";
        showToast(errorMsg, "error");
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'تأكيد الرصد';
        }
    }
}


function toggleEmojiPicker(targetId) {
    // Simple prompt fallback
    const emojis = ["👤", "🏆", "🌟", "📚", "🕌", "⚽", "🧠", "⚔️", "🛡️", "🎒", "🎓"];
    const current = document.getElementById(targetId.replace('-btn', '')).value;

    // Create a temporary simple picker using native browser prompt is ugly. 
    // Let's cycle through them or show a mini modal. 
    // For now, let's just Randomize on click for fun/speed, or cycle.
    // Or better: prompt the user to paste an emoji? No.
    // Cycle:
    let idx = emojis.indexOf(current);
    if (idx === -1) idx = 0;
    const next = emojis[(idx + 1) % emojis.length];

    const inputId = targetId.replace('-btn', '');
    const previewId = targetId.replace('-btn', '-preview');

    document.getElementById(inputId).value = next;
    document.getElementById(previewId).textContent = next;
}


async function handleSaveStudent(e) {
    e.preventDefault();
    const btn = $('#save-student-btn');
    btn.disabled = true;

    const id = $('#student-id').value;
    const fileInput = document.getElementById('student-image-upload');
    let imageBase64 = $('#student-emoji').value; // Default or existing

    // Handle Image Upload
    if (fileInput && fileInput.files[0]) {
        imageBase64 = await compressImage(fileInput.files[0]);
    }

    let studentNumber = $('#student-number').value.trim();
    // Phone Format Logic (966) using normalizePhone
    studentNumber = normalizePhone(studentNumber);

    const data = {
        name: $('#student-name').value,
        studentNumber: studentNumber,
        parentPhone: studentNumber, // Same as studentNumber for parent lookup
        level: state.currentLevel,  // Level for parent to see
        memorizationPlan: $('#student-memorization').value,
        reviewPlan: $('#student-review').value,
        icon: imageBase64, // Store Base64 Image
        password: $('#student-password-edit').value, // Student Password
        updatedAt: new Date()
    };

    // Mandatory Password for new students
    if (!id && !data.password) {
        // showToast("كلمة المرور مطلوبة للطالب الجديد", "error"); // Moved to inline
        const errEl = document.getElementById('password-error');
        if (errEl) errEl.classList.remove('hidden');
        btn.disabled = false;
        return;
    } else {
        const errEl = document.getElementById('password-error');
        if (errEl) errEl.classList.add('hidden');
    }

    try {
        if (id) {
            await window.firebaseOps.updateDoc(window.firebaseOps.doc(window.db, "students", id), data);
            showToast("تم التحديث");
        } else {
            data.createdAt = new Date();
            data.level = state.currentLevel;
            const docRef = await window.firebaseOps.addDoc(window.firebaseOps.collection(window.db, "students"), data);
            showToast("تم الإضافة");

            // Optimistic Update: Add to local state immediately
            data.id = docRef.id;
            // Convert createdAt to something sort-compatible (Timestamp-like) just for UI
            data.createdAt = { seconds: Date.now() / 1000 };
            state.students.push(data);
            // Sort
            state.students.sort((a, b) => {
                const aSec = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
                const bSec = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
                return bSec - aSec;
            });
            updateStudentsListUI();
        }
        closeModal('student-modal');
    } catch (err) { console.error(err); showToast("خطأ", "error"); }
    finally { btn.disabled = false; }
}

function openAddCompetitionModal() {
    $('#competition-id').value = '';
    const titleEl = document.querySelector('#competition-modal h3');
    if (titleEl) titleEl.textContent = 'إضافة مسابقة جديدة';

    $('#competition-form').reset();
    $('#criteria-list').innerHTML = '';
    addCriteriaItem(); // Add one default
    toggleModal('competition-modal', true);
}

async function openEditCompetition(id) {
    if (!state.isTeacher) return;

    try {
        const docSnap = await window.firebaseOps.getDoc(window.firebaseOps.doc(window.db, "competitions", id));
        if (!docSnap.exists()) {
            showToast("المسابقة غير موجودة", "error");
            return;
        }
        const data = docSnap.data();

        $('#competition-id').value = id;
        $('#competition-name').value = data.name || '';
        $('#competition-emoji').value = data.icon || '🏆';
        $('#comp-absent-excuse').value = data.absentExcuse || 1;
        $('#comp-absent-no-excuse').value = data.absentNoExcuse || 4;
        $('#comp-activity-points').value = data.activityPoints || 0;
        $('#comp-activity-absent-points').value = data.activityAbsentPoints || 0;

        const titleEl = document.querySelector('#competition-modal h3');
        if (titleEl) titleEl.textContent = 'تعديل المسابقة';

        // Populate Criteria
        $('#criteria-list').innerHTML = '';
        if (data.criteria && Array.isArray(data.criteria) && data.criteria.length > 0) {
            data.criteria.forEach(c => addCriteriaItem(c.name, c.positivePoints, c.negativePoints));
        } else {
            addCriteriaItem();
        }

        toggleModal('competition-modal', true);
        lucide.createIcons();
    } catch (e) {
        console.error(e);
        showToast("خطأ في جلب البيانات", "error");
    }
}

// Duplicates removed

// Emoji Picker & Other Modals



// --- Initialization ---

let isAppInitialized = false;

function init() {
    if (isAppInitialized) return;
    isAppInitialized = true;

    applyTheme();

    // Check Persistence
    if (loadAuth()) {
        // Already logged in
        $('#loading').classList.add('hidden');
        $('#app-content-wrapper').classList.remove('hidden'); // Show content
        $('#view-container').classList.remove('hidden'); // CRITICAL: Show view container
        updateUIMode();

        // Start Global Sync
        startGlobalDataSync();

        // Navigate based on role
        const startView = state.isParent ? 'parent' : 'home';
        // Replace initial state so Android Back button exits app from start screen
        history.replaceState({ view: startView }, '', `#${startView}`);
        router.render(startView);
    } else {
        // Needs Login (Show Auth Overlay)
        $('#loading').classList.add('hidden');
        showAuthModal();
        history.replaceState({ view: 'auth' }, '', '#auth');
    }
}

function startGlobalDataSync() {
    if (!state.currentLevel) return;

    // 1. Competitions Sync
    if (competitionsUnsubscribe) competitionsUnsubscribe();
    const qComp = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "competitions"),
        window.firebaseOps.where("level", "==", state.currentLevel)
    );
    competitionsUnsubscribe = window.firebaseOps.onSnapshot(qComp, function (snapshot) {
        const comps = [];
        snapshot.forEach(function (doc) {
            var data = doc.data();
            data.id = doc.id;
            comps.push(data);
        });
        comps.sort(function (a, b) {
            const aSec = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
            const bSec = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
            return bSec - aSec;
        });
        state.competitions = comps;
        // If we are on competitions view, update UI
        if (state.currentView === 'competitions') updateCompetitionsListUI();
        // Leaderboard depends on active comp
        calculateLeaderboard();
    });

    // 2. Groups Sync
    if (activeGroupsUnsubscribe) activeGroupsUnsubscribe();
    const qGroups = window.firebaseOps.query(window.firebaseOps.collection(window.db, "groups"));
    activeGroupsUnsubscribe = window.firebaseOps.onSnapshot(qGroups, function (snap) {
        const allGroups = [];
        snap.forEach(function (d) {
            var data = d.data();
            data.id = d.id;
            allGroups.push(data);
        });
        state.groups = allGroups;
        calculateLeaderboard();
    });
}

// Global History Listener for Android Back Button
window.addEventListener('popstate', (event) => {
    // 1. Close any open modals first (User Expectation: Back = Close Modal)
    const modals = document.querySelectorAll('[id$="-modal"]:not(.hidden)');
    if (modals.length > 0) {
        modals.forEach(m => {
            m.classList.add('hidden');
            m.remove(); // Also remove dynamically created modals
        });
        // Push current state back to prevent further back navigation issues
        history.pushState({ view: state.currentView }, '', `#${state.currentView}`);
        return; // Don't navigate, just closed modal
    }

    // 2. Determine home view based on mode
    const homeView = state.isParent ? 'parent' : 'home';

    // 3. If already on home view, let Android handle it (exit app)
    if (state.currentView === homeView) {
        return; // Exit app
    }

    // 4. Otherwise, go back to home view
    history.replaceState({ view: homeView }, '', `#${homeView}`);
    router.render(homeView);
});


// === COMPETITION MANAGEMENT ===
function addCriteriaItem(name = '', pos = '', neg = '') {
    const container = document.getElementById('criteria-list');
    if (!container) return; // Guard
    const id = Date.now() + Math.random().toString(36).substr(2, 9);

    const div = document.createElement('div');
    div.className = 'flex gap-2 items-center bg-gray-50 dark:bg-gray-700 p-2 rounded-xl mb-2';
    div.innerHTML = `
                                                            <input type="text" placeholder="اسم المعيار" class="criteria-name flex-1 bg-white dark:bg-gray-600 border rounded-lg px-3 py-2 text-sm" value="${name}" required>
                                                                <div class="flex items-center gap-1">
                                                                    <span class="text-xs font-bold text-green-600">+</span>
                                                                    <input type="number" placeholder="+" class="criteria-pos w-16 bg-white dark:bg-gray-600 border rounded-lg px-2 py-2 text-sm text-center" min="1" value="${pos}" required>
                                                                </div>
                                                                <div class="flex items-center gap-1">
                                                                    <span class="text-xs font-bold text-red-500">-</span>
                                                                    <input type="number" placeholder="-" class="criteria-neg w-16 bg-white dark:bg-gray-600 border rounded-lg px-2 py-2 text-sm text-center" min="0" value="${neg}">
                                                                </div>
                                                                <button type="button" onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 p-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                                                                `;
    container.appendChild(div);
    if (window.lucide) window.lucide.createIcons();
}

async function handleSaveCompetition(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('save-competition-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'جاري الحفظ...';
    }

    try {
        const id = document.getElementById('competition-id').value;
        const name = document.getElementById('competition-name').value;
        const icon = document.getElementById('competition-emoji').value;
        const absentExcuse = parseInt(document.getElementById('comp-absent-excuse').value) || 1;
        const absentNoExcuse = parseInt(document.getElementById('comp-absent-no-excuse').value) || 4;
        const activityPoints = parseInt(document.getElementById('comp-activity-points').value) || 0;
        const activityAbsentPoints = parseInt(document.getElementById('comp-activity-absent-points').value) || 0;

        // Collect Criteria
        const criteriaVals = [];
        document.querySelectorAll('#criteria-list > div').forEach(div => {
            criteriaVals.push({
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                name: div.querySelector('.criteria-name').value,
                positivePoints: parseInt(div.querySelector('.criteria-pos').value) || 0,
                negativePoints: parseInt(div.querySelector('.criteria-neg').value) || 0
            });
        });

        if (criteriaVals.length === 0) {
            showToast("يجب إضافة معيار واحد على الأقل", "error");
            return; // Finally will run to reset button
        }

        const data = {
            name,
            icon,
            criteria: criteriaVals,
            absentExcuse,
            absentNoExcuse,
            activityPoints,
            activityAbsentPoints,
            level: state.currentLevel,
            updatedAt: new Date()
        };

        if (id) {
            await window.firebaseOps.updateDoc(window.firebaseOps.doc(window.db, "competitions", id), data);
            showToast("تم تحديث المسابقة");
        } else {
            data.createdAt = new Date();
            await window.firebaseOps.addDoc(window.firebaseOps.collection(window.db, "competitions"), data);
            showToast("تم إنشاء المسابقة");
        }
        closeModal('competition-modal');
    } catch (err) {
        console.error("Save Error:", err);
        showToast("خطأ في الاتصال أو الحفظ", "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'حفظ المسابقة';
        }
    }
}

async function toggleCompetitionActive(id) {
    if (!state.isTeacher) return;
    try {
        // 1. Deactivate all others in this level
        const currentActive = state.competitions.find(c => c.active);
        if (currentActive && currentActive.id !== id) {
            await window.firebaseOps.updateDoc(window.firebaseOps.doc(window.db, "competitions", currentActive.id), { active: false });
        }

        // 2. Toggle target (or set true if we enforce single active)
        // User wants "Select Active". If already active, maybe de-active? Or just keep.
        // Let's toggle.
        const target = state.competitions.find(c => c.id === id);
        const newState = !target.active;

        await window.firebaseOps.updateDoc(window.firebaseOps.doc(window.db, "competitions", id), { active: newState });
        showToast(newState ? "تم تفعيل المسابقة" : "تم إلغاء تفعيل المسابقة");
    } catch (e) {
        console.error(e);
        showToast("خطأ في تغيير الحالة", "error");
    }
}

// Initialization Trigger
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Safety timeout
        setTimeout(() => { if (!isAppInitialized) init(); }, 3000);

        if (window.firebaseOps) init();
        else window.addEventListener('firebaseReady', init, { once: true });
    });
} else {
    // Safety timeout
    setTimeout(() => { if (!isAppInitialized) init(); }, 3000);

    if (window.firebaseOps) init();
    else window.addEventListener('firebaseReady', init, { once: true });
}

// === ABSENCE & WHATSAPP LOGIC ===
function openAbsenceOptions() {
    // Get current competition settings
    const comp = state.competitions.find(c => c.id === currentGradingCompId);
    const absentExcuse = comp && comp.absentExcuse ? comp.absentExcuse : 1;
    const absentNoExcuse = comp && comp.absentNoExcuse ? comp.absentNoExcuse : 4;

    let modal = document.getElementById('absence-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'absence-modal';
        modal.className = 'fixed inset-0 bg-black/60 z-[150] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in';
        // Content will be set below
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
            <div class="bg-orange-100 dark:bg-orange-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-orange-600 dark:text-orange-400">
                <i data-lucide="user-x" class="w-8 h-8"></i>
            </div>
            <h3 class="font-bold text-lg mb-2">تسجيل غياب</h3>
            <p class="text-gray-500 text-sm mb-6"> هل غاب الطالب بعذر أم بدون عذر؟</p>
            <div class="grid grid-cols-1 gap-3">
                <button onclick="confirmAbsence('excuse')" class="py-3 rounded-xl bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 font-bold transition">
                    غائب بعذر (-${absentExcuse})
                </button>
                <button onclick="confirmAbsence('no-excuse')" class="py-3 rounded-xl bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 font-bold transition">
                    غائب بدون عذر (-${absentNoExcuse})
                </button>
                <button onclick="document.getElementById('absence-modal').remove()" class="py-2 text-gray-400 hover:text-gray-600 font-medium text-sm mt-2">إلغاء</button>
            </div>
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
}

async function confirmAbsence(type) {
    if (!type) return;

    // Get Competition Config
    const comp = state.competitions.find(c => c.id === currentGradingCompId);
    // Default values if not set
    const excusePoints = parseInt((comp && comp.absentExcuse) ? comp.absentExcuse : 1);
    const noExcusePoints = parseInt((comp && comp.absentNoExcuse) ? comp.absentNoExcuse : 4);

    const points = type === 'excuse' ? -excusePoints : -noExcusePoints;
    const label = type === 'excuse' ? 'غائب بعذر' : 'غائب بدون عذر';

    // Submit as a special score
    await submitScore('ABSENCE_RECORD', points, label, 'negative');

    var absenceModal = document.getElementById('absence-modal');
    if (absenceModal) absenceModal.remove();

    // Notify Parent via WhatsApp
    var student = state.students.find(function (s) { return s.id === currentRateStudentId; });
    if (student && student.studentNumber) {
        var phone = student.studentNumber;
        var msg = "السلام عليكم ولي أمر الطالب " + student.name + "،\nتم تسجيل غياب للطالب اليوم (" + label + ").\nنرجو الحرص على الحضور.";
        var url = "https://wa.me/" + phone + "?text=" + encodeURIComponent(msg);
        window.open(url, '_blank');
    }
}

async function generateWeeklyReport() {
    const student = state.students.find(s => s.id === currentRateStudentId);
    if (!student) return;

    if (!student.studentNumber) {
        showToast("لا يوجد رقم هاتف لولي الأمر", "error");
        return;
    }

    const comp = state.competitions.find(c => c.id === currentGradingCompId);
    if (!comp) return;

    // 1. Calculate Date Range (Sun - Thu) of Current Week
    const today = new Date();
    const dayOfWeek = today.getDay(); // Sun=0, Sat=6
    // If today is Friday(5) or Sat(6), we still report for the past week (Sun-Thu).
    // Start of Week (Sunday):
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    // Format dates for comparison (YYYY-MM-DD)
    // We need to fetch scores from Firestore or use locally cached state.scores if reliable.
    // state.scores currently fetches ALL scores in 'renderHome'. 
    // In 'renderCompetitions' -> 'grading', we might not have all scores loaded if we are teacher and didn't visit home?
    // Let's query Firestore for this student for this week to be safe and accurate.

    // Days Passed (Sun -> Today). Clamp to 5 (Thu).
    // Force 5 days (Sun, Mon, Tue, Wed, Thu)
    const daysPassed = 5;

    const dateStrings = [];
    for (let i = 0; i < daysPassed; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        // Manual YYYY-MM-DD
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dateStrings.push(`${year}-${month}-${day}`);
    }

    showToast("جاري إعداد التقرير...");

    try {
        // Query scores for student
        // We can't use 'in' query for dates easily if array large, but max 5.
        const q = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "scores"),
            window.firebaseOps.where("studentId", "==", student.id),
            window.firebaseOps.where("competitionId", "==", comp.id),
            window.firebaseOps.where("date", "in", dateStrings)
        );

        const snap = await window.firebaseOps.getDocs(q);
        const scores = [];
        snap.forEach(d => scores.push(d.data()));

        // NEW: Fetch Activity Days Log
        const activityQuery = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "activity_days"),
            window.firebaseOps.where("competitionId", "==", comp.id),
            window.firebaseOps.where("date", "in", dateStrings)
        );
        const activitySnap = await window.firebaseOps.getDocs(activityQuery);
        const activityLog = {}; // date -> points
        let activityDaysTaken = 0;
        let totalActivityPossible = 0;
        activitySnap.forEach(d => {
            const data = d.data();
            activityLog[data.date] = data.points;
            activityDaysTaken++;
            totalActivityPossible += (parseInt(data.points) || 0);
        });

        // Calculate Totals per Criteria
        let reportText = `📊 *تقرير الأسبوع الماضي* 📊\n`;
        reportText += `👤 الطالب: ${student.name}\n`;
        reportText += `📅 الأسبوع: ${dateStrings[0]} إلى ${dateStrings[dateStrings.length - 1]}\n`;
        if (activityDaysTaken > 0) {
            reportText += `🎪 تم إقامة نشاط (${activityDaysTaken} يوم)\n`;
        }
        reportText += `------------------\n`;

        let totalEarned = 0;
        let totalPossible = 0;

        const normalDaysCount = daysPassed - activityDaysTaken;

        if (comp.criteria) {
            comp.criteria.forEach(c => {
                // Earned
                const cScores = scores.filter(s => s.criteriaId === c.id);
                const earned = cScores.reduce((sum, s) => sum + s.points, 0);

                // Possible: Criteria Points * Normal Days
                const possible = (parseInt(c.positivePoints) || 0) * normalDaysCount;

                reportText += `🔹 ${c.name}: ${earned} / ${possible}\n`;

                totalEarned += earned;
                totalPossible += possible;
            });
        }

        // Add Activity Points if any
        if (activityDaysTaken > 0) {
            const activityScores = scores.filter(s => s.criteriaId === 'ACTIVITY_DAY');
            const activityEarned = activityScores.reduce((sum, s) => sum + s.points, 0);
            reportText += `🏃 نقاط النشاط: ${activityEarned} / ${totalActivityPossible}\n`;
            totalEarned += activityEarned;
            totalPossible += totalActivityPossible;
        }

        // Add Absence Deductions if any
        const absences = scores.filter(s => s.criteriaId === 'ABSENCE_RECORD');
        let absentDays = [];
        if (absences.length > 0) {
            const deduction = absences.reduce((sum, s) => sum + s.points, 0);
            reportText += `⚠️ خصم غياب: ${deduction}\n`;
            absences.forEach(ab => {
                absentDays.push(`${ab.date} (${ab.criteriaName || 'غياب'})`);
            });
            totalEarned += deduction;
        }

        if (absentDays.length > 0) {
            reportText += `❌ أيام الغياب:\n${absentDays.join('\n')}\n`;
        }

        reportText += `------------------\n`;
        reportText += `✨ *المجموع النهائي: ${totalEarned} / ${totalPossible}*\n`;
        reportText += `\nشاكرين تعاونكم 🌹`;

        // Send
        const url = `https://wa.me/${student.studentNumber}?text=${encodeURIComponent(reportText)}`;
        window.open(url, '_blank');

    } catch (e) {
        console.error(e);
        showToast("خطأ في إنشاء التقرير", "error");
    }
}

// Global Modals Helper
function ensureGlobalModals() {
    if (!document.getElementById('student-modal')) {
        const modalsHTML = getStudentModalHTML() + getCompetitionModalsHTML();
        document.body.insertAdjacentHTML('beforeend', modalsHTML);
        document.body.insertAdjacentHTML('beforeend', getGradingModalsHTML());
    }
}

// Delete Competition Function
let compToDeleteId = null;
async function deleteCompetition(id) {
    compToDeleteId = id;
    toggleModal('delete-competition-modal', true);
    document.getElementById('confirm-delete-comp-btn').onclick = performDeleteCompetition;
}

async function performDeleteCompetition() {
    if (!compToDeleteId) return;
    try {
        await window.firebaseOps.deleteDoc(window.firebaseOps.doc(window.db, "competitions", compToDeleteId));
        showToast("تم حذف المسابقة");
        closeModal('delete-competition-modal');
    } catch (e) {
        console.error(e);
        showToast("خطأ في حذف المسابقة", "error");
    }
}

// === PARENT PORTAL ===

async function renderParentDashboard() {
    const container = $('#view-container');

    // If we need to reload students (e.g. after page refresh)
    if (state.parentStudents.length === 0 && state.parentPhone) {
        const q = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "students"),
            window.firebaseOps.where("parentPhone", "==", state.parentPhone)
        );
        const snap = await window.firebaseOps.getDocs(q);
        state.parentStudents = [];
        snap.forEach(doc => {
            var dData = doc.data();
            dData.id = doc.id;
            state.parentStudents.push(dData);
        });
    }

    const students = state.parentStudents;

    container.innerHTML = `
        <div class="p-4 pb-24 max-w-lg mx-auto">
            <!-- Header -->
            <div class="bg-gradient-to-r from-amber-500 to-amber-600 rounded-2xl p-6 mb-6 text-white shadow-lg">
                <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center text-3xl">👨‍👩‍👧‍👦</div>
                    <div>
                        <h1 class="text-xl font-bold">بوابة ولي الأمر</h1>
                        <p class="text-amber-100 text-sm">متابعة أداء أبنائك</p>
                    </div>
                </div>
            </div>

            <!-- Students Count -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4 shadow-sm border flex items-center justify-between">
                <div>
                    <p class="text-gray-500 text-sm">عدد الطلاب المسجلين</p>
                    <p class="text-2xl font-bold text-amber-600">${students.length}</p>
                </div>
                <div class="w-12 h-12 bg-amber-100 dark:bg-amber-900 rounded-xl flex items-center justify-center text-xl">📚</div>
            </div>

            <!-- Students List -->
            <h2 class="font-bold text-lg mb-3 flex items-center gap-2"><i data-lucide="users" class="w-5 h-5 text-amber-600"></i> أبنائي</h2>
            <div class="space-y-3">
                ${students.length === 0 ? '<p class="text-center text-gray-400 py-8">لا يوجد طلاب مسجلين بهذا الرقم</p>' : ''}
                ${students.map(s => {
        const level = LEVELS[s.level] || { name: 'غير محدد', emoji: '📚' };
        const iconHtml = (s.icon && s.icon.startsWith('data:image'))
            ? `<img src="${s.icon}" class="w-full h-full object-cover rounded-full">`
            : (s.icon || '👤');
        return `
                    <div onclick="openStudentReport('${s.id}')" class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border hover:border-amber-400 cursor-pointer transition flex items-center gap-4">
                        <div class="w-14 h-14 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-2xl border-2 border-amber-200 overflow-hidden">
                            ${iconHtml}
                        </div>
                        <div class="flex-1">
                            <h3 class="font-bold text-gray-800 dark:text-gray-100">${s.name}</h3>
                            <p class="text-xs text-gray-500">${level.emoji} ${level.name}</p>
                        </div>
                        <div class="text-amber-500">
                            <i data-lucide="chevron-left" class="w-5 h-5"></i>
                        </div>
                    </div>
                    `;
    }).join('')}
            </div>

            <!-- Logout Button -->
            <button onclick="logout()" class="w-full mt-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 transition flex items-center justify-center gap-2">
                <i data-lucide="log-out" class="w-4 h-4"></i>
                تسجيل الخروج
            </button>
        </div>
    `;
    lucide.createIcons();
}

async function openStudentReport(studentId) {
    const container = $('#view-container');
    container.innerHTML = '<div class="flex justify-center p-8"><i data-lucide="loader-2" class="animate-spin w-8 h-8 text-amber-600"></i></div>';
    lucide.createIcons();

    const student = state.parentStudents.find(s => s.id === studentId);
    if (!student) {
        container.innerHTML = '<p class="text-center text-red-500 p-8">الطالب غير موجود</p>';
        return;
    }

    const level = LEVELS[student.level] || { name: 'غير محدد', emoji: '📚' };

    // Fetch student scores
    const scoresQuery = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "scores"),
        window.firebaseOps.where("studentId", "==", studentId)
    );
    const scoresSnap = await window.firebaseOps.getDocs(scoresQuery);
    const scores = [];
    scoresSnap.forEach(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        scores.push(data);
    });

    // Calculate statistics
    let totalPoints = 0;
    let absenceDays = 0;
    let absenceWithExcuse = 0;
    let absenceNoExcuse = 0;
    const criteriaStats = {};
    const absenceRecordsWithExcuse = [];
    const absenceRecordsNoExcuse = [];

    scores.forEach(s => {
        totalPoints += (s.points || 0);

        if (s.criteriaId === 'ABSENCE_RECORD') {
            absenceDays++;
            if (s.criteriaName && s.criteriaName.indexOf('بعذر') !== -1) {
                absenceWithExcuse++;
                absenceRecordsWithExcuse.push({ date: s.date || 'غير محدد', points: s.points });
            } else {
                absenceNoExcuse++;
                absenceRecordsNoExcuse.push({ date: s.date || 'غير محدد', points: s.points });
            }
        } else {
            const key = s.criteriaName || 'أخرى';
            if (!criteriaStats[key]) criteriaStats[key] = { positive: 0, negative: 0, count: 0 };
            criteriaStats[key].count++;
            if (s.points > 0) criteriaStats[key].positive += s.points;
            else criteriaStats[key].negative += s.points;
        }
    });

    // Store absence records in window for modal access
    window._absenceRecordsWithExcuse = absenceRecordsWithExcuse.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    window._absenceRecordsNoExcuse = absenceRecordsNoExcuse.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Fetch student's group
    let groupName = 'غير محدد';
    const groupsQuery = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "groups"),
        window.firebaseOps.where("members", "array-contains", studentId)
    );
    const groupsSnap = await window.firebaseOps.getDocs(groupsQuery);
    if (!groupsSnap.empty) {
        groupName = groupsSnap.docs[0].data().name;
    }

    // Fetch ALL teachers for this level
    let teachers = [];
    const teachersQuery = window.firebaseOps.query(
        window.firebaseOps.collection(window.db, "teachers"),
        window.firebaseOps.where("level", "==", student.level)
    );
    const teachersSnap = await window.firebaseOps.getDocs(teachersQuery);
    teachersSnap.forEach(doc => {
        var data = doc.data();
        data.id = doc.id;
        teachers.push(data);
    });

    const iconHtml = (student.icon && student.icon.startsWith('data:image'))
        ? `<img src="${student.icon}" class="w-full h-full object-cover rounded-full">`
        : (student.icon || '👤');

    // Generate contact button HTML based on teachers count
    let contactHTML = '';
    if (teachers.length === 0) {
        contactHTML = `
            <div class="bg-gray-100 dark:bg-gray-700 rounded-xl p-4 text-center text-gray-500 text-sm">
                <i data-lucide="info" class="w-5 h-5 mx-auto mb-2"></i>
                لم يتم تسجيل بيانات المعلم بعد
            </div>
        `;
    } else if (teachers.length === 1) {
        contactHTML = `
            <button onclick="contactTeacher('${student.name}', '${teachers[0].phone}')" class="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-3">
                <i data-lucide="message-circle" class="w-5 h-5"></i>
                تواصل مع المعلم (${teachers[0].name || 'المعلم'})
            </button>
        `;
    } else {
        // Multiple teachers - store in window for modal access
        window._teachersForContact = teachers;
        window._currentStudentName = student.name;
        contactHTML = `
            <button onclick="openTeacherSelectionModal()" class="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-3">
                <i data-lucide="message-circle" class="w-5 h-5"></i>
                تواصل مع المعلم (${teachers.length} معلمين)
            </button>
        `;
    }

    container.innerHTML = `
        <div class="p-4 pb-24 max-w-lg mx-auto">
            <!-- Back Button -->
            <button onclick="renderParentDashboard()" class="flex items-center gap-2 text-gray-500 hover:text-amber-600 mb-4 font-bold">
                <i data-lucide="arrow-right" class="w-4 h-4"></i>
                العودة لقائمة الأبناء
            </button>

            <!-- Student Header -->
            <div class="bg-gradient-to-r from-teal-500 to-teal-600 rounded-2xl p-6 mb-6 text-white shadow-lg">
                <div class="flex items-center gap-4">
                    <div class="w-20 h-20 bg-white rounded-full flex items-center justify-center text-3xl border-4 border-white/50 overflow-hidden">
                        ${iconHtml}
                    </div>
                    <div>
                        <h1 class="text-xl font-bold">${student.name}</h1>
                        <p class="text-teal-100 text-sm">${level.emoji} ${level.name}</p>
                        <p class="text-teal-100 text-xs mt-1">🛡️ الحلقة: ${groupName}</p>
                    </div>
                </div>
            </div>

            <!-- Quick Stats -->
            <div class="grid grid-cols-3 gap-3 mb-6">
                <div class="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm border">
                    <p class="text-2xl font-bold ${totalPoints >= 0 ? 'text-green-600' : 'text-red-600'}">${totalPoints}</p>
                    <p class="text-xs text-gray-500">النقاط</p>
                </div>
                <div class="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm border">
                    <p class="text-2xl font-bold text-orange-600">${absenceDays}</p>
                    <p class="text-xs text-gray-500">أيام الغياب</p>
                </div>
                <div class="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm border">
                    <p class="text-2xl font-bold text-blue-600">${scores.length}</p>
                    <p class="text-xs text-gray-500">إجمالي التقييمات</p>
                </div>
            </div>

            <!-- Memorization Plan -->
            ${student.memorizationPlan || student.reviewPlan ? `
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4 shadow-sm border">
                <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="book-open" class="w-4 h-4 text-teal-600"></i> الخطة</h3>
                ${student.memorizationPlan ? `<p class="text-sm mb-2"><span class="font-bold text-teal-600">الحفظ:</span> ${student.memorizationPlan}</p>` : ''}
                ${student.reviewPlan ? `<p class="text-sm"><span class="font-bold text-purple-600">المراجعة:</span> ${student.reviewPlan}</p>` : ''}
            </div>
            ` : ''}

            <!-- Absence Details -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4 shadow-sm border">
                <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="calendar-x" class="w-4 h-4 text-orange-600"></i> تفاصيل الغياب</h3>
                <div class="grid grid-cols-2 gap-3">
                    <div onclick="showAbsenceDates('excuse')" class="bg-teal-50 dark:bg-teal-900/30 rounded-xl p-3 text-center cursor-pointer hover:ring-2 hover:ring-teal-400 transition">
                        <p class="text-xl font-bold text-teal-700 dark:text-teal-400">${absenceWithExcuse}</p>
                        <p class="text-xs text-teal-600">بعذر ▸</p>
                    </div>
                    <div onclick="showAbsenceDates('noexcuse')" class="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-center cursor-pointer hover:ring-2 hover:ring-red-400 transition">
                        <p class="text-xl font-bold text-red-700 dark:text-red-400">${absenceNoExcuse}</p>
                        <p class="text-xs text-red-600">بدون عذر ▸</p>
                    </div>
                </div>
            </div>

            <!-- Criteria Breakdown -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4 shadow-sm border">
                <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="bar-chart-3" class="w-4 h-4 text-blue-600"></i> تفصيل المعايير</h3>
                ${Object.keys(criteriaStats).length === 0 ? '<p class="text-center text-gray-400 text-sm py-2">لا توجد درجات مسجلة بعد</p>' : ''}
                <div class="space-y-2">
                    ${Object.entries(criteriaStats).map(([name, data]) => `
                    <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-lg p-2">
                        <span class="text-sm font-medium">${name}</span>
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-green-600 font-bold">+${data.positive}</span>
                            <span class="text-xs text-red-600 font-bold">${data.negative}</span>
                            <span class="text-xs text-gray-400">(${data.count})</span>
                        </div>
                    </div>
                    `).join('')}
                </div>
            </div>

            <!-- Contact Teacher -->
            ${contactHTML}
        </div>
    `;
    lucide.createIcons();
}

function contactTeacher(studentName, teacherPhone) {
    const message = encodeURIComponent(`السلام عليكم ورحمة الله وبركاته
أنا ولي أمر الطالب (${studentName})
كنت أريد أن أستفسر منك عن بعض الأمور`);

    window.open(`https://wa.me/${teacherPhone}?text=${message}`, '_blank');
}

function openTeacherSelectionModal() {
    const teachers = window._teachersForContact || [];
    const studentName = window._currentStudentName || '';

    if (teachers.length === 0) {
        showToast("لا يوجد معلمون مسجلون", "error");
        return;
    }

    // Create modal
    let modal = document.getElementById('teacher-selection-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'teacher-selection-modal';
        document.body.appendChild(modal);
    }

    modal.className = 'fixed inset-0 bg-black/50 z-[150] flex items-center justify-center p-4 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-bold text-lg">اختر المعلم للتواصل</h3>
                <button onclick="document.getElementById('teacher-selection-modal').remove()" class="text-gray-400 hover:text-gray-600">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>
            <div class="space-y-3">
                ${teachers.map(t => `
                <button onclick="contactTeacher('${studentName}', '${t.phone}'); document.getElementById('teacher-selection-modal').remove();" 
                    class="w-full flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl hover:bg-green-50 dark:hover:bg-green-900/30 border hover:border-green-400 transition">
                    <div class="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center text-lg">👨‍🏫</div>
                    <div class="flex-1 text-right">
                        <p class="font-bold text-sm">${t.name}</p>
                        <p class="text-xs text-gray-500" dir="ltr">${t.phone}</p>
                    </div>
                    <i data-lucide="message-circle" class="w-5 h-5 text-green-600"></i>
                </button>
                `).join('')}
            </div>
        </div>
    `;

    lucide.createIcons();
}

// Show absence dates modal for parent view
function showAbsenceDates(type) {
    const records = type === 'excuse' ? window._absenceRecordsWithExcuse : window._absenceRecordsNoExcuse;
    const title = type === 'excuse' ? 'أيام الغياب بعذر' : 'أيام الغياب بدون عذر';
    const color = type === 'excuse' ? 'teal' : 'red';
    const emoji = type === 'excuse' ? '✅' : '❌';

    if (!records || records.length === 0) {
        showToast("لا يوجد أيام غياب مسجلة", "error");
        return;
    }

    // Create or reuse modal
    let modal = document.getElementById('absence-dates-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'absence-dates-modal';
        document.body.appendChild(modal);
    }

    modal.className = 'fixed inset-0 bg-black/50 z-[150] flex items-center justify-center p-4 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl max-h-[70vh] flex flex-col">
            <!-- Header -->
            <div class="p-4 border-b flex justify-between items-center shrink-0">
                <h3 class="font-bold text-lg flex items-center gap-2">
                    <span class="text-xl">${emoji}</span>
                    ${title}
                </h3>
                <button onclick="document.getElementById('absence-dates-modal').remove()" class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>
            
            <!-- Body -->
            <div class="p-4 flex-1 overflow-y-auto">
                <p class="text-sm text-gray-500 mb-3">إجمالي: ${records.length} يوم</p>
                <div class="space-y-2">
                    ${records.map((r, i) => `
                    <div class="flex items-center justify-between p-3 bg-${color}-50 dark:bg-${color}-900/20 rounded-xl border border-${color}-100 dark:border-${color}-800">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 bg-${color}-100 dark:bg-${color}-900 rounded-lg flex items-center justify-center text-${color}-600 dark:text-${color}-400 font-bold text-sm">${i + 1}</div>
                            <div>
                                <p class="font-bold text-gray-800 dark:text-gray-100">${r.date}</p>
                            </div>
                        </div>
                        <span class="text-${color}-600 dark:text-${color}-400 font-bold">${r.points} نقطة</span>
                    </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    lucide.createIcons();
}

// Reset Competition Logic
let compToResetId = null;
function resetCompetition(id) {
    compToResetId = id;
    toggleModal('reset-competition-modal', true);
    document.getElementById('confirm-reset-comp-btn').onclick = performResetCompetition;
}

async function performResetCompetition() {
    if (!compToResetId) return;
    showToast("جاري تصفير الدرجات...");

    try {
        const q = window.firebaseOps.query(
            window.firebaseOps.collection(window.db, "scores"),
            window.firebaseOps.where("competitionId", "==", compToResetId)
        );

        const snap = await window.firebaseOps.getDocs(q);
        const batch = window.firebaseOps.writeBatch(window.db);

        snap.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();

        showToast("تم تصفير المسابقة بنجاح");
        closeModal('reset-competition-modal');
        // Refresh home list
        renderHome();
    } catch (e) {
        console.error("Error resetting competition:", e);
        showToast("خطأ في تصفير المسابقة", "error");
    }
}

async function deleteGroup(groupId) {
    toggleModal('delete-modal', true);

    document.getElementById('confirm-delete-btn').onclick = async () => {
        try {
            await window.firebaseOps.deleteDoc(window.firebaseOps.doc(window.db, "groups", groupId));
            showToast("تم حذف المجموعة بنجاح");
            closeModal('delete-modal');
            // Reload groups list
            if (typeof fetchGroupsForCompetition === 'function' && typeof currentManageCompId !== 'undefined') {
                fetchGroupsForCompetition(currentManageCompId);
            }
        } catch (e) {
            console.error("Error deleting group:", e);
            showToast("خطأ في حذف المجموعة", "error");
        }
    };
}
