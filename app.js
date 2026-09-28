if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(() => console.log('SW registrado'))
            .catch(err => console.error(err));
    });
}

(function() {
  var DEFAULT_CATEGORIES = [
    { id: 'comida', name: 'Comida' },
    { id: 'transporte', name: 'Transporte' },
    { id: 'renta', name: 'Renta' },
    { id: 'deudas', name: 'Deudas' },
    { id: 'negocio', name: 'Negocio' },
    { id: 'ocio', name: 'Ocio' },
    { id: 'salud', name: 'Salud' },
    { id: 'otros', name: 'Otros' }
  ];

  var state = {
    db: null,
    useLocal: false,
    categories: DEFAULT_CATEGORIES.slice(),
    folders: [],
    txs: [],
    viewDate: new Date(),
    editingId: null,
    formType: 'expense',
    formCategory: null,
    formFolder: null
  };

  var fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  var fmtExact = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  var monthFmt = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
  var dayFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });

  var els = {};
  ['prevMonth','nextMonth','monthLabel','balanceAmt','incomeAmt','expenseAmt',
   'categoryBreakdown','foldersList','txList','openAdd','OpenSavings','sheetBackdrop','sheetTitle',
   'typeExpense','typeIncome','amtInput','catPicker','dateInput','noteInput',
   'cancelBtn','deleteBtn','saveBtn','toast','themeToggle','savingsAmt'].forEach(function(id) {
    els[id] = document.getElementById(id);
  });

  // ---------- Local storage fallback ----------
  var LS_TX = 'libreta_tx';
  var LS_CAT = 'libreta_cat';
  var LS_FOLDERS = 'libreta_folders';

  
  function localLoad() {
    try {
      var tx = JSON.parse(localStorage.getItem(LS_TX) || '[]');
      var cat = JSON.parse(localStorage.getItem(LS_CAT) || 'null');
      var folders = JSON.parse(localStorage.getItem(LS_FOLDERS) || '[]');
      state.txs = tx;
      if (cat) state.categories = cat;
      state.folders = folders;
    } catch (e) { state.txs = []; }
  }
  function localSaveTx() {
    try { localStorage.setItem(LS_TX, JSON.stringify(state.txs)); } catch (e) {}
  }
  function localSaveCat() {
    try { localStorage.setItem(LS_CAT, JSON.stringify(state.categories)); } catch (e) {}
  }
  function localSaveFolders() {
    try { localStorage.setItem(LS_FOLDERS, JSON.stringify(state.folders)); } catch (e) {}
  }
  // ---------- Theme ----------
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('libreta_theme'); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }
  els.themeToggle.addEventListener('click', function() {
    var cur = document.documentElement.getAttribute('data-theme');
    var isDark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('libreta_theme', next); } catch (e) {}
  });
  initTheme();

  // ---------- Data init ----------
  async function initData() {
    try {
      var db = await claude.use('db');
      if (db) {
        state.db = db;
        var catDoc = await db.doc('meta/categories').get();
        if (catDoc.exists && catDoc.data && catDoc.data.list) {
          state.categories = catDoc.data.list;
        } else {
          await db.doc('meta/categories').set({ list: DEFAULT_CATEGORIES });
          state.categories = DEFAULT_CATEGORIES.slice();
        }

        var folderDoc = await db.doc('meta/folders').get();
        state.folders = (folderDoc.exists && folderDoc.data && folderDoc.data.list) ? folderDoc.data.list : [];

        var snap = await db.collection('transactions').get();
        state.txs = snap.docs.map(function(d) {
          var data = d.data();
          data.id = d.id;
          return data;
        });
      } else {
        state.useLocal = true;
        localLoad();
      }
    } catch (e) {
      state.useLocal = true;
      localLoad();
    }
    render();
  }

  async function saveCategories() {
    if (state.db && !state.useLocal) {
      try { await state.db.doc('meta/categories').set({ list: state.categories }); }
      catch (e) { localSaveCat(); }
    } else {
      localSaveCat();
    }
  }

  async function saveFolders() {
    if (state.db && !state.useLocal) {
      try {
        await state.db.doc('meta/folders').set({ list: state.folders });
      } catch (e) { localSaveFolders(); }
    } else {
      localSaveFolders();
    }
  }

  async function upsertTx(tx) {
    if (state.db && !state.useLocal) {
      try {
        if (tx.id) {
          var id = tx.id;
          var body = Object.assign({}, tx);
          delete body.id;
          await state.db.collection('transactions').doc(id).set(body);
          var idx = state.txs.findIndex(function(t) { return t.id === id; });
          if (idx >= 0) state.txs[idx] = tx; else state.txs.push(tx);
        } else {
          var body2 = Object.assign({}, tx);
          var ref = await state.db.collection('transactions').add(body2);
          tx.id = ref.id;
          state.txs.push(tx);
        }
        return;
      } catch (e) { /* fall through to local */ }
    }
    if (!tx.id) tx.id = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    var idx2 = state.txs.findIndex(function(t) { return t.id === tx.id; });
    if (idx2 >= 0) state.txs[idx2] = tx; else state.txs.push(tx);
    localSaveTx();
  }

  async function deleteTx(id) {
    var tx = state.txs.find(function(t) {return t.id === id;});
    if (tx && tx.type === 'savings'){
      var folder = state.folders.find(function(f) {return f.id === tx.folderId;});
      if (folder) {
        folder.balance += tx.direction === 'deposit' ? -tx.amount : tx.amount;
        await saveFolders();
      }
    }

    if (state.db && !state.useLocal) {
      try { await state.db.collection('transactions').doc(id).delete(); }
      catch (e) {}
    }
    state.txs = state.txs.filter(function(t) { return t.id !== id; });
    localSaveTx();
  }

  // ---------- Folders ----------

  function addFolder(name, goal){
    var id = name.toLowerCase().trim().replace(/[^a-z0-9áéíóúñ]+/gi, '-').replace(/^-+|-+$/g, '') || ('folder' + Date.now());
    if (state.folders.find(function(f) { return f.id === id;})) {id = id + '-' + Date.now();}
    state.folders.push({ id: id, name: name.trim(), goal: goal || 0, balance: 0 });
    saveFolders();
    return id;
  }

  function deleteFolder(id){
    state.folders = state.folders.filter(function(f) {return f.id !== id; });
    saveFolders();
  } 
  
  function updateFolder(id, name, goal) {
    var f = state.folders.find(function(f) { return f.id === id; });
    if (!f) return;
    f.name = name.trim();
    f.goal = goal;
    saveFolders();
  }

  function editFolder(id) {
    var f = state.folders.find(function(f) { return f.id === id; });
    if (!f) return;
    var name = prompt('Nombre del apartado:', f.name);
    if (name === null || !name.trim()) return;
    var goalStr = prompt('Meta (0 o vacío = sin meta):', f.goal || '');
    if (goalStr === null) return;
    var goal = parseFloat(goalStr);
    updateFolder(id, name, isNaN(goal) || goal < 0 ? 0 : goal);
    render();
    showToast('Apartado actualizado');
  }

  function removeFolder(id) {
    var f = state.folders.find(function(f) { return f.id === id; });
    if (!f) return;
    if (f.balance > 0) { showToast('Retira el saldo antes de eliminar el apartado'); return; }
    if (!confirm('¿Eliminar el apartado "' + f.name + '"?')) return;
    deleteFolder(id);
    render();
    showToast('Apartado eliminado');
  }

  async function moveSavings(folderID, direction, amount, note, date){
    var folder = state.folders.find(function(f){ return f.id === folderID;});
    if (!folder) return { ok: false, error: 'Apartado no encontrado'};

    if (direction === 'withdraw' && amount > folder.balance ){
      return { ok:false, error: 'No pedes retirar más de lo que tienes ahorrado'}
    }

    if (direction === 'deposit' && amount > monthBalance(date)) {
      return{ ok: false, error: 'El depósito excede el balance disponible del mes'}; 
    }

    folder.balance += direction === 'deposit' ? amount : -amount;
    await saveFolders();

    var tx = {
      type: 'savings',
      direction: direction,
      folderID: folderID,
      amount: amount,
      note: note || '',
      date: date,
      createdAt: Date.now()
    };
    await upsertTx(tx);
    return { ok: true};
  }



  // ---------- Helpers ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function catName(id) {
    var c = state.categories.find(function(c) { return c.id === id; });
    return c ? c.name : 'Otros';
  }

  function folderName(id) {
      var f = state.folders.find(function(f) {return f.id === id;});
      return f ? f.name : 'Apartado'
  }

  function monthTxs() {
    var y = state.viewDate.getFullYear(), m = state.viewDate.getMonth();
    return state.txs.filter(function(t) {
      var d = new Date(t.date + 'T00:00:00');
      return d.getFullYear() === y && d.getMonth() === m;
    });
  }

  function monthBalance(dateStr){
    var d = new Date(dateStr + 'T00:00:00');
    var y = d.getFullYear(), m = d.getMonth();
    var bal = 0;
    state.txs.forEach(function(t){
      var td = new Date(t.date + 'T00:00:00');
      if(td.getFullYear() !== y || td.getMonth() !== m)return;
      if(t.type === 'income') bal += t.amount;
      else if (t.type === 'expense') bal -= t.amount;
      else if (t.type === 'savings') bal -= t.direction === 'deposit' ? t.amount : -t.amount;
    });
    return bal;
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(function() { els.toast.classList.remove('show'); }, 1800);
  }

  // ---------- Render ----------
  function render() {
    els.monthLabel.textContent = monthFmt.format(state.viewDate);
    var txs = monthTxs();
    var income = 0, expense = 0, savingsMonth = 0;
    var byCat = {};
    txs.forEach(function(t) {
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') { expense += t.amount; byCat[t.categoryId] = (byCat[t.categoryId] || 0)+ t.amount;}
      else if (t.type === 'savings') { savingsMonth += t.direction === 'deposit' ? t.amount : -t.amount;} 
    });

    var totalSaved = state.folders.reduce(function(sum, f) { return sum + f.balance; }, 0);
    els.balanceAmt.textContent = fmt.format(income - expense - savingsMonth);
    els.incomeAmt.textContent = fmt.format(income);
    els.expenseAmt.textContent = fmt.format(expense);
    els.savingsAmt.textContent = fmt.format(totalSaved);

    // category breakdown
    var catEntries = Object.keys(byCat).map(function(id) { return { id: id, amt: byCat[id] }; })
      .sort(function(a, b) { return b.amt - a.amt; });
    if (catEntries.length === 0) {
      els.categoryBreakdown.innerHTML = '<div class="empty-note">Sin gastos este mes.</div>';
    } else {
      var max = catEntries[0].amt;
      els.categoryBreakdown.innerHTML = catEntries.map(function(e) {
        var pct = max > 0 ? Math.max(6, Math.round((e.amt / max) * 100)) : 0;
        return '<div class="cat-row"><div class="name">' + escapeHtml(catName(e.id)) + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="amt">' + fmt.format(e.amt) + '</div></div>';
      }).join('');
    }

    renderFolders();

    // tx list grouped by day
    var sorted = txs.slice().sort(function(a, b) { return b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0); });
    if (sorted.length === 0) {
      els.txList.innerHTML = '<div class="empty-note">Aún no hay movimientos este mes.</div>';
    } else {
      var groups = {};
      var order = [];
      sorted.forEach(function(t) {
        if (!groups[t.date]) { groups[t.date] = []; order.push(t.date); }
        groups[t.date].push(t);
      });
      els.txList.innerHTML = order.map(function(date) {
        var d = new Date(date + 'T00:00:00');
        var items = groups[date].map(function(t) {
          var label, sign, cls;
          if (t.type === 'savings') {
            label = folderName(t.folderId) + (t.direction === 'withdraw' ? ' (retiro)' : ' (depósito)');
            sign = t.direction === 'deposit' ? '-' : '+';
            cls = t.direction === 'deposit' ? 'expense' : 'income';
          } else {
            label = catName(t.categoryId);
            sign = t.type === 'income' ? '+' : '-';
            cls = t.type;
          }
          return '<div class="tx ' + cls + '" data-id="' + t.id + '">' +
            '<div class="dot"></div>' +
            '<div class="info"><div class="cat">' + escapeHtml(label) + '</div>' +
            (t.note ? '<div class="note">' + escapeHtml(t.note) + '</div>' : '') + '</div>' +
            '<div class="amt">' + sign + fmtExact.format(t.amount).replace('MX$', '$') + '</div></div>';
        }).join('');
        return '<div class="day-group"><div class="day-label">' + dayFmt.format(d) + '</div>' + items + '</div>';
      }).join('');
      Array.prototype.forEach.call(els.txList.querySelectorAll('.tx'), function(el) {
        el.addEventListener('click', function() { openEdit(el.getAttribute('data-id')); });
      });
    }
  }

  function renderFolders(){
    if (state.folders.length === 0){
      els.foldersList.innerHTML = '<div class="empty-note">Aún no tienes apartados </div>';
      return;
    }
    els.foldersList.innerHTML = state.folders.map(function(f) {
      var pct = f.goal >0 ? Math.min(100, Math.round((f.balance / f.goal)* 100)) : 0;
      var goalText = f.goal >0 ? (fmt.format(f.balance) + ' de ' + fmt.format(f.goal)) : fmt.format(f.balance);
      return '<div class="cat-row"><div class="name">' + escapeHtml(f.name) + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="amt">' + goalText + '</div><button type="button" class="icon-btn" data-action="edit" data-id="' + f.id + '">✎</button>' +
      '<button type="button" class="icon-btn" data-action="delete" data-id="' + f.id + '">✕</button></div>';
    }).join('');

    Array.prototype.forEach.call(els.foldersList.querySelectorAll('.icon-btn'), function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        if (btn.getAttribute('data-action') === 'edit') editFolder(id);
        else removeFolder(id);
  });
});
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ---------- Month nav ----------
  els.prevMonth.addEventListener('click', function() {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
    render();
  });
  els.nextMonth.addEventListener('click', function() {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    render();
  });

  // ---------- Sheet / form ----------
  function renderCatPicker() {
    var chips = state.categories.map(function(c) {
      var sel = c.id === state.formCategory ? ' selected' : '';
      return '<button type="button" class="cat-chip' + sel + '" data-id="' + c.id + '">' + escapeHtml(c.name) + '</button>';
    }).join('');
    chips += '<button type="button" class="cat-chip add-new" id="addCatChip">+ nueva</button>';
    els.catPicker.innerHTML = chips;
    Array.prototype.forEach.call(els.catPicker.querySelectorAll('.cat-chip:not(.add-new)'), function(el) {
      el.addEventListener('click', function() {
        state.formCategory = el.getAttribute('data-id');
        renderCatPicker();
      });
    });
    document.getElementById('addCatChip').addEventListener('click', function() {
      var name = prompt('Nombre de la nueva categoría:');
      if (!name) return;
      var id = name.toLowerCase().trim().replace(/[^a-z0-9áéíóúñ]+/gi, '-').replace(/^-+|-+$/g, '') || ('cat' + Date.now());
      if (state.categories.find(function(c) { return c.id === id; })) { id = id + '-' + Date.now(); }
      state.categories.push({ id: id, name: name.trim() });
      state.formCategory = id;
      saveCategories();
      renderCatPicker();
    });
  }

  function renderFolderPicker(){
    if (state.folders.length === 0) {
      els.catPicker.innerHTML = '<div class="empty-note">Aún no tienes apartados. Crea uno primero.</div>' + '<button type="button" class="cat-chip add-new" id="addFolderChip">+ nuevo apartado</button>';
    } else {
      var chips = state.folders.map(function(f) {
        var sel = f.id === state.formFolder ? ' selected': '';
        return '<button type="button" class="cat-chip' + sel + '" data-id="' + f.id + '">' + escapeHtml(f.name) + '</button>';
      }).join('');
      chips += '<button type="button" class="cat-chip add-new" id="addFolderChip">+ nuevo apartado</button>';
      els.catPicker.innerHTML = chips;
      Array.prototype.forEach.call(els.catPicker.querySelectorAll('.cat-chip:not(.add-new)'), function(el) {
        el.addEventListener('click', function(){
          state.formFolder = el.getAttribute('data-id');
          renderFolderPicker();
        })
      })
    }

    document.getElementById('addFolderChip').addEventListener('click', function(){
      var name = prompt('Nombre del apartado:');
      if(!name) return;
      var goalStr = prompt('Meta (opcional)');
      var goal = parseFloat(goalStr);
      var id = addFolder(name, isNaN(goal) ? 0 :goal);
      state.formFolder = id;
      renderFolderPicker();
    });
  }

  function setSavingsDirection(direction) {
    state.formDirection = direction;
    els.typeExpense.classList.toggle('active', direction === 'deposit');
    els.typeIncome.classList.toggle('active', direction === 'withdraw');
  }

  function resetSavingsForm(){
    state.editingId = null;
    state.formType = 'savings';
    state.formFolder = state.folders[0] ? state.folders[0].id : null;
    els.sheetTitle.textContent = 'Mover a Apartado';
    els.amtInput.value = '';
    els.noteInput.value = '';
    els.dateInput.value = isoDate(new Date());
    els.deleteBtn.style.display = 'none';
    els.typeExpense.textContent = 'Depositar';
    els.typeIncome.textContent = 'Retirar';
    setSavingsDirection('deposit');
    renderFolderPicker();
  }

  function setFormType(type) {
    state.formType = type;
    els.typeExpense.classList.toggle('active', type === 'expense');
    els.typeIncome.classList.toggle('active', type === 'income');
  }
  els.typeExpense.addEventListener('click', function() {
    if (state.formType === 'savings') setSavingsDirection('deposit');
    else setFormType('expense');
  });
  els.typeIncome.addEventListener('click', function() {
    if(state.formType === 'savings') setSavingsDirection('withdraw');
    else setFormType('income');
  });

  function openSheet() {
    els.sheetBackdrop.classList.add('open');
  }
  function closeSheet() {
    els.sheetBackdrop.classList.remove('open');
  }
  els.cancelBtn.addEventListener('click', closeSheet);
  els.sheetBackdrop.addEventListener('click', function(e) { if (e.target === els.sheetBackdrop) closeSheet(); });

  function resetForm() {
    state.editingId = null;
    state.formType = 'expense';
    state.formCategory = state.categories[0] ? state.categories[0].id : null;
    els.sheetTitle.textContent = 'Nuevo movimiento';
    els.amtInput.value = '';
    els.noteInput.value = '';
    els.dateInput.value = isoDate(new Date());
    els.deleteBtn.style.display = 'none';
    els.typeExpense.textContent = 'Gasto';
    els.typeIncome.textContent = 'Ingreso';
    setFormType('expense');
    renderCatPicker();
  }

  els.openAdd.addEventListener('click', function() {
    resetForm();
    openSheet();
  });

  els.OpenSavings.addEventListener('click', function(){
    resetSavingsForm();
    openSheet();
  });

  function openEdit(id) {
    var t = state.txs.find(function(t) { return t.id === id; });
    if (!t) return;
    state.editingId = id;
    state.formCategory = t.categoryId;
    els.sheetTitle.textContent = 'Editar movimiento';
    els.amtInput.value = t.amount;
    els.noteInput.value = t.note || '';
    els.dateInput.value = t.date;
    els.deleteBtn.style.display = '';
    setFormType(t.type);
    renderCatPicker();
    openSheet();
  }

  els.deleteBtn.addEventListener('click', async function() {
    if (!state.editingId) return;
    await deleteTx(state.editingId);
    closeSheet();
    render();
    showToast('Movimiento eliminado');
  });

  els.saveBtn.addEventListener('click', async function() {
    var amt = parseFloat(els.amtInput.value);
    if (!amt || amt <= 0) { els.amtInput.focus(); return; }
    if (!els.dateInput.value) { els.dateInput.value = isoDate(new Date()); }
    if (state.formType === 'savings'){
      if(!state.formFolder) { showToast('Selecciona un apartado'); return; }
      var result = await moveSavings(state.formFolder, state.formDirection, Math.round(amt * 100) / 100, els.noteInput.value.trim(), els.dateInput.value);
      if (!result.ok) { showToast(result.error); return;}
      closeSheet();
      render();
      showToast('Movimiento guardado');
      return;
    }

    if (!state.formCategory) { state.formCategory = state.categories[0] ? state.categories[0].id : 'otros'; }
    var tx = {
      id: state.editingId,
      amount: Math.round(amt * 100) / 100,
      type: state.formType,
      categoryId: state.formCategory,
      note: els.noteInput.value.trim(),
      date: els.dateInput.value,
      createdAt: Date.now()
    };
    await upsertTx(tx);
    closeSheet();
    render();
    showToast(state.editingId ? 'Movimiento actualizado' : 'Movimiento guardado');
  });

  initData();
})();