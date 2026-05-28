let azuDatabase;
let checkoutCart = [];
const STARTING_CASH_FLOAT = 50000.00;
const INDEXEDDB_STORAGE_KEY = "azu_pharmacy_persistent_db";

// Initialize SQL WebAssembly Engine and handle Local Sync restoration layers
initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` }).then(async SQL => {
    
    // Check if an existing database payload resides inside the browser's IndexedDB partition
    const serializedExistingDatabase = await restoreDatabaseStateFromBrowserStorage();
    
    if (serializedExistingDatabase) {
        // Hydrate running memory using the user's permanent database array
        azuDatabase = new SQL.Database(serializedExistingDatabase);
        console.log("Successfully restored database state from browser storage partition.");
    } else {
        // Setup a blank canvas configuration if this is the first execution on this device
        azuDatabase = new SQL.Database();
        buildDatabaseStructures();
        generateMockPharmacyStock(); 
        await saveActiveDatabaseStateToBrowserStorage();
    }
    
    refreshAllViewsData();
}).catch(error => console.error("Critical Database Engine initialization broken: ", error));

function buildDatabaseStructures() {
    azuDatabase.run(`
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            cost_price REAL NOT NULL,
            selling_price REAL NOT NULL,
            quantity INTEGER NOT NULL,
            min_quantity INTEGER NOT NULL
        );
    `);
    azuDatabase.run(`
        CREATE TABLE IF NOT EXISTS sales_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_timestamp TEXT NOT NULL,
            items_summary TEXT NOT NULL,
            total_billed REAL NOT NULL,
            cash_paid REAL NOT NULL,
            card_paid REAL NOT NULL,
            total_cost REAL NOT NULL,
            total_profit REAL NOT NULL
        );
    `);
}

function generateMockPharmacyStock() {
    const baselineItems = [
        ['Paracetamol 500mg Tablets', 120.00, 200.00, 1500, 200],
        ['Amoxicillin 500mg Capsules', 950.00, 1500.00, 45, 100], 
        ['Ibuprofen 400mg Tabs', 220.00, 400.00, 800, 150],
        ['Vitamin C Soluble 1000mg', 600.00, 1000.00, 12, 100],  
        ['Metformin 500mg Tablets', 1100.00, 1800.00, 95, 80]
    ];
    const stmt = azuDatabase.prepare("INSERT INTO inventory (name, cost_price, selling_price, quantity, min_quantity) VALUES (?, ?, ?, ?, ?)");
    baselineItems.forEach(row => stmt.run(row));
    stmt.free();
}

// --- INDEXEDDB FRONTEND PERSISTENCE LAYER FUNCTIONS ---

function saveActiveDatabaseStateToBrowserStorage() {
    return new Promise((resolve, reject) => {
        // Export running database into an immutable binary Uint8Array stream
        const binaryDatabaseState = azuDatabase.export();
        
        // Open low-level connection pipeline into browser's IndexedDB storage
        const request = indexedDB.open("AzuPharmacyStorageContext", 1);
        
        request.onupgradeneeded = function(e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("binaries")) {
                db.createObjectStore("binaries");
            }
        };
        
        request.onsuccess = function(e) {
            const db = e.target.result;
            const transaction = db.transaction(["binaries"], "readwrite");
            const store = transaction.objectStore("binaries");
            
            // Overwrite binary records with current state
            const putRequest = store.put(binaryDatabaseState, INDEXEDDB_STORAGE_KEY);
            
            putRequest.onsuccess = () => resolve(true);
            putRequest.onerror = (err) => reject(err);
        };
        
        request.onerror = (err) => reject(err);
    });
}

function restoreDatabaseStateFromBrowserStorage() {
    return new Promise((resolve) => {
        const request = indexedDB.open("AzuPharmacyStorageContext", 1);
        
        request.onupgradeneeded = function(e) {
            e.target.result.createObjectStore("binaries");
        };
        
        request.onsuccess = function(e) {
            const db = e.target.result;
            const transaction = db.transaction(["binaries"], "readonly");
            const store = transaction.objectStore("binaries");
            const getRequest = store.get(INDEXEDDB_STORAGE_KEY);
            
            getRequest.onsuccess = function() {
                resolve(getRequest.result ? getRequest.result : null);
            };
            getRequest.onerror = () => resolve(null);
        };
        
        request.onerror = () => resolve(null);
    });
}

// Data Utility File System Handlers
function exportDatabaseFileToFileSystem() {
    const binaryData = azuDatabase.export();
    const blobObject = new Blob([binaryData], { type: "application/octet-stream" });
    const downloadAnchor = document.createElement("a");
    
    downloadAnchor.href = URL.createObjectURL(blobObject);
    downloadAnchor.download = `azu_pharmacy_backup_${new Date().toISOString().slice(0,10)}.sqlite`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
}

function importDatabaseFileFromFileSystem(event) {
    const targetedFile = event.target.files[0];
    if (!targetedFile) return;

    const fileReader = new FileReader();
    fileReader.onload = async function(e) {
        try {
            const bufferArray = new Uint8Array(e.target.result);
            // Re-instantiate global database context from the imported binary file
            azuDatabase = new initSqlJs.BufferPassedDatabase ? new initSqlJs.Database(bufferArray) : Object.assign(azuDatabase, new (await initSqlJs()).Database(bufferArray));
            
            await saveActiveDatabaseStateToBrowserStorage();
            refreshAllViewsData();
            alert("Database backup file successfully imported and activated.");
        } catch(err) {
            alert("Critical Error: Failed to parse uploaded database file.");
            console.error(err);
        }
    };
    fileReader.readAsArrayBuffer(targetedFile);
}

// --- STANDARD WORKSPACE UI HANDLERS ---

function refreshAllViewsData() {
    renderInventoryTable();
    renderDailySalesHistoryPage();
    renderFinancialDashboardSummary();
}

function switchMainView(targetView) {
    destroyExistingPortalDropdowns();
    document.querySelectorAll('.main-view').forEach(view => view.classList.add('view-hidden'));
    document.querySelectorAll('.navbar .nav-links button').forEach(btn => btn.classList.remove('active'));

    document.getElementById(`view-${targetView}`).classList.remove('view-hidden');
    document.getElementById(`nav-${targetView}`).classList.add('active');

    if (targetView === 'inventory') routeToSubpage('drug-list');
    else if (targetView === 'sales') switchSalesSubTab('pos');
    else if (targetView === 'finance') switchFinanceSubTab('sales');
}

function switchSalesSubTab(subTab) {
    document.getElementById('sales-subpage-pos').classList.add('view-hidden');
    document.getElementById('sales-subpage-daily').classList.add('view-hidden');
    document.getElementById('tab-pos').classList.remove('sub-active');
    document.getElementById('tab-daily-sales').classList.remove('sub-active');

    document.getElementById(`sales-subpage-${subTab}`).classList.remove('view-hidden');
    document.getElementById(`tab-${subTab === 'pos' ? 'pos' : 'daily-sales'}`).classList.add('sub-active');
    
    if(subTab === 'pos') setTimeout(() => document.getElementById('sales-search').focus(), 50);
    else if(subTab === 'daily') renderDailySalesHistoryPage();
}

function switchFinanceSubTab(subTab) {
    document.getElementById('finance-subpage-sales').classList.add('view-hidden');
    document.getElementById('finance-subpage-profit').classList.add('view-hidden');
    document.getElementById('tab-fin-sales').classList.remove('sub-active');
    document.getElementById('tab-fin-profit').classList.remove('sub-active');

    document.getElementById(`finance-subpage-${subTab}`).classList.remove('view-hidden');
    document.getElementById(`tab-fin-${subTab}`).classList.add('sub-active');

    if(subTab === 'sales') renderFinancialDashboardSummary();
    if(subTab === 'profit') loadProfitReport('day');
}

function routeToSubpage(subpageId) {
    destroyExistingPortalDropdowns();
    const listSubpages = ['subpage-drug-list', 'subpage-add-drug', 'subpage-view-drug', 'subpage-update-drug', 'subpage-delete-drug', 'subpage-drugs-to-buy'];
    listSubpages.forEach(id => document.getElementById(id).classList.add('view-hidden'));

    document.getElementById(`subpage-${subpageId}`).classList.remove('view-hidden');
    if (subpageId === 'drug-list') renderInventoryTable();
}

// --- DATABASE TRANSACTIONS MODIFIERS (Saves to state asynchronously on complete) ---

async function executeAddDrug(event) {
    event.preventDefault();
    azuDatabase.run("INSERT INTO inventory (name, cost_price, selling_price, quantity, min_quantity) VALUES (?, ?, ?, ?, ?)", 
        [document.getElementById('add-field-name').value, parseFloat(document.getElementById('add-field-cost').value), parseFloat(document.getElementById('add-field-selling').value), parseInt(document.getElementById('add-field-qty').value), parseInt(document.getElementById('add-field-min').value)]);
    
    document.getElementById('add-drug-form').reset();
    await saveActiveDatabaseStateToBrowserStorage();
    routeToSubpage('drug-list');
}

async function executeUpdateDrug(event) {
    event.preventDefault();
    azuDatabase.run("UPDATE inventory SET name=?, cost_price=?, selling_price=?, quantity=?, min_quantity=? WHERE id=?", 
        [document.getElementById('update-field-name').value, parseFloat(document.getElementById('update-field-cost').value), parseFloat(document.getElementById('update-field-selling').value), parseInt(document.getElementById('update-field-qty').value), parseInt(document.getElementById('update-field-min').value), document.getElementById('update-field-id').value]);
    
    await saveActiveDatabaseStateToBrowserStorage();
    routeToSubpage('drug-list');
}

async function executeDeleteDrug() {
    azuDatabase.run("DELETE FROM inventory WHERE id = ?", [document.getElementById('delete-field-id').value]);
    await saveActiveDatabaseStateToBrowserStorage();
    routeToSubpage('drug-list');
}

async function processCheckout() {
    if(checkoutCart.length === 0) return alert("Checkout rejected: Shopping basket is empty.");
    const grandTotal = parseFloat(document.getElementById('cart-grand-total').innerText);
    const paymentMode = document.getElementById('payment-mode').value;
    
    let cashComponent = 0, cardComponent = 0;
    if (paymentMode === 'Cash') cashComponent = grandTotal;
    else if (paymentMode === 'Card') cardComponent = grandTotal;
    else {
        cashComponent = parseFloat(document.getElementById('split-cash-amount').value) || 0;
        cardComponent = parseFloat(document.getElementById('split-card-amount').value) || 0;
    }

    let summaryText = '', totalCost = 0;
    checkoutCart.forEach(item => {
        azuDatabase.run("UPDATE inventory SET quantity = quantity - ? WHERE id = ?", [item.currentQty, item.id]);
        summaryText += `${item.name} (x${item.currentQty}), `;
        totalCost += (item.costPrice * item.currentQty);
    });

    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    azuDatabase.run("INSERT INTO sales_history VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)",
        [timestamp, summaryText.slice(0, -2), grandTotal, cashComponent, cardComponent, totalCost, (grandTotal - totalCost)]);

    document.getElementById('receipt-print-data').innerHTML = `
        <div class="receipt-paper-view">
            <h3>AZU PHARMACY RECEIPT</h3>
            <p>Date: ${timestamp}</p>
            <p>Items: ${summaryText.slice(0, -2)}</p>
            <h4>Total Paid: ₦${grandTotal.toFixed(2)}</h4>
            <p style="font-size:0.8rem; color:#475569;">Cash: ₦${cashComponent.toFixed(2)} | Card: ₦${cardComponent.toFixed(2)}</p>
        </div>
    `;
    
    document.getElementById('receipt-modal').classList.add('open');
    checkoutCart = [];
    
    await saveActiveDatabaseStateToBrowserStorage();
    refreshCartUI(); 
    refreshAllViewsData();
}

// --- DATA READ OPERATIONS ---

function renderInventoryTable() {
    const searchFilter = document.getElementById('inventory-search-input').value;
    const tableBody = document.getElementById('inventory-main-table-body');
    tableBody.innerHTML = '';

    let sql = "SELECT * FROM inventory";
    let params = [];
    if (searchFilter) { sql += " WHERE name LIKE ?"; params.push(`%${searchFilter}%`); }

    const stmt = azuDatabase.prepare(sql);
    stmt.bind(params);

    while (stmt.step()) {
        const drug = stmt.getAsObject();
        let restockCellContent = drug.quantity < drug.min_quantity ? `<span class="badge-danger-alert">Restock needed</span>` : '';
        tableBody.innerHTML += `
            <tr>
                <td><div class="drug-name-click" onclick="spawnPortalDropdown(event, ${drug.id})">${drug.name}</div></td>
                <td>₦${drug.cost_price.toFixed(2)}</td>
                <td>₦${drug.selling_price.toFixed(2)}</td>
                <td><strong>${drug.quantity}</strong></td>
                <td>${restockCellContent}</td>
            </tr>`;
    }
    stmt.free();
}

function loadDrugsToBuyPage() {
    const tbody = document.getElementById('procurement-table-body');
    tbody.innerHTML = '';
    const stmt = azuDatabase.prepare("SELECT * FROM inventory WHERE quantity < min_quantity");
    let count = 0;
    while (stmt.step()) {
        count++;
        const drug = stmt.getAsObject();
        tbody.innerHTML += `
            <tr>
                <td><strong>${drug.name}</strong></td>
                <td><span style="color:var(--danger-color); font-weight:bold;">${drug.quantity}</span></td>
                <td>${drug.min_quantity}</td>
                <td><input type="number" value="${drug.min_quantity - drug.quantity}" min="1" style="padding: 6px 10px; border-radius:6px;"></td>
            </tr>`;
    }
    stmt.free();
    if (count === 0) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#64748b; padding:30px;">All stocks healthy! No drugs are currently flagged for restock.</td></tr>`;
    routeToSubpage('drugs-to-buy');
}

function searchSalesCounter() {
    const inputQuery = document.getElementById('sales-search').value;
    const dropContainer = document.getElementById('sales-dropdown-results');
    dropContainer.innerHTML = '';
    if (!inputQuery) return;

    const stmt = azuDatabase.prepare("SELECT * FROM inventory WHERE name LIKE ? ORDER BY name ASC");
    stmt.bind([`%${inputQuery}%`]);
    while (stmt.step()) {
        const drug = stmt.getAsObject();
        const item = document.createElement('div');
        item.className = 'dropdown-entry-item';
        item.innerHTML = `💊 ${drug.name} — ₦${drug.selling_price.toFixed(2)}`;
        item.onclick = () => { addItemToCart(drug); document.getElementById('sales-search').value = ''; dropContainer.innerHTML = ''; };
        dropContainer.appendChild(item);
    }
    stmt.free();
}

function spawnPortalDropdown(event, drugId) {
    event.stopPropagation();
    destroyExistingPortalDropdowns();
    const rect = event.target.getBoundingClientRect();
    const portal = document.createElement('div');
    portal.className = 'dropdown-menu-portal';
    portal.id = 'active-portal-dropdown';
    portal.style.top = `${rect.bottom + window.scrollY}px`;
    portal.style.left = `${rect.left + window.scrollX}px`;
    portal.innerHTML = `
        <button onclick="loadViewDrugPage(${drugId})">View drug details</button>
        <button onclick="loadUpdateDrugPage(${drugId})">Update drug details</button>
        <button onclick="loadDeleteDrugPage(${drugId})">Delete drug records</button>`;
    document.body.appendChild(portal);
}

function destroyExistingPortalDropdowns() {
    const existingPortal = document.getElementById('active-portal-dropdown');
    if(existingPortal) existingPortal.remove();
}
document.addEventListener('click', destroyExistingPortalDropdowns);

function queryDrugRow(id) {
    const stmt = azuDatabase.prepare("SELECT * FROM inventory WHERE id = ?");
    stmt.bind([id]); stmt.step();
    const res = stmt.getAsObject();
    stmt.free(); return res;
}

function loadViewDrugPage(id) {
    const data = queryDrugRow(id);
    document.getElementById('view-field-name').value = data.name;
    document.getElementById('view-field-cost').value = `₦${data.cost_price.toFixed(2)}`;
    document.getElementById('view-field-selling').value = `₦${data.selling_price.toFixed(2)}`;
    document.getElementById('view-field-qty').value = `${data.quantity} Units`;
    document.getElementById('view-field-min').value = `${data.min_quantity} Units`;
    routeToSubpage('view-drug');
}

function loadUpdateDrugPage(id) {
    const data = queryDrugRow(id);
    document.getElementById('update-field-id').value = data.id;
    document.getElementById('update-field-name').value = data.name;
    document.getElementById('update-field-cost').value = data.cost_price;
    document.getElementById('update-field-selling').value = data.selling_price;
    document.getElementById('update-field-qty').value = data.quantity;
    document.getElementById('update-field-min').value = data.min_quantity;
    routeToSubpage('update-drug');
}

function loadDeleteDrugPage(id) {
    const data = queryDrugRow(id);
    document.getElementById('delete-field-id').value = data.id;
    document.getElementById('delete-display-name').value = data.name;
    routeToSubpage('delete-drug');
}

function addItemToCart(drug) {
    if(drug.quantity <= 0) return alert("Operation rejected: Selected item is out of stock.");
    const match = checkoutCart.find(r => r.id === drug.id);
    if(match) {
        if(match.currentQty >= drug.quantity) return alert("Operation rejected: Max available stock capacity reached.");
        match.currentQty++;
    } else {
        checkoutCart.push({ id: drug.id, name: drug.name, sellingPrice: drug.selling_price, costPrice: drug.cost_price, currentQty: 1, maxLimit: drug.quantity });
    }
    refreshCartUI();
}

function refreshCartUI() {
    const tbody = document.getElementById('cart-table-body');
    tbody.innerHTML = ''; let runTotal = 0;
    checkoutCart.forEach((item, index) => {
        const total = item.sellingPrice * item.currentQty;
        runTotal += total;
        tbody.innerHTML += `<tr><td>${item.name}</td><td><input type="number" min="1" max="${item.maxLimit}" value="${item.currentQty}" style="width:55px;" onchange="modifyCartQty(${index}, this.value)"></td><td>₦${item.sellingPrice.toFixed(2)}</td><td>₦${total.toFixed(2)}</td><td><button class="btn btn-danger" style="padding:4px 8px;" onclick="removeCartItem(${index})">X</button></td></tr>`;
    });
    document.getElementById('cart-grand-total').innerText = runTotal.toFixed(2);
    toggleSplitPaymentFields();
}

function modifyCartQty(index, value) {
    const val = parseInt(value);
    if(val > checkoutCart[index].maxLimit) checkoutCart[index].currentQty = checkoutCart[index].maxLimit;
    else checkoutCart[index].currentQty = val || 1;
    refreshCartUI();
}

function removeCartItem(index) { checkoutCart.splice(index, 1); refreshCartUI(); }

function toggleSplitPaymentFields() {
    const mode = document.getElementById('payment-mode').value;
    const splitBox = document.getElementById('split-inputs-container');
    const grandTotal = parseFloat(document.getElementById('cart-grand-total').innerText);
    if (mode === 'Split') {
        splitBox.classList.remove('view-hidden');
        document.getElementById('split-cash-amount').value = (grandTotal / 2).toFixed(2);
        calculateSplitBalance();
    } else {
        splitBox.classList.add('view-hidden');
    }
}

function calculateSplitBalance() {
    const grandTotal = parseFloat(document.getElementById('cart-grand-total').innerText);
    let cashPaid = parseFloat(document.getElementById('split-cash-amount').value) || 0;
    if(cashPaid > grandTotal) {
        cashPaid = grandTotal;
        document.getElementById('split-cash-amount').value = grandTotal;
    }
    document.getElementById('split-card-amount').value = (grandTotal - cashPaid).toFixed(2);
}

function closeReceiptWindow() { document.getElementById('receipt-modal').classList.remove('open'); }

function renderDailySalesHistoryPage() {
    const scrollContainer = document.getElementById('daily-invoices-scroll-area');
    scrollContainer.innerHTML = '';
    let dailyCashSum = 0, dailyDigitalSum = 0;
    const todayDateString = new Date().toISOString().slice(0, 10);

    const stmt = azuDatabase.prepare("SELECT * FROM sales_history WHERE sale_timestamp LIKE ? ORDER BY id DESC");
    stmt.bind([`${todayDateString}%`]);

    while(stmt.step()) {
        const sale = stmt.getAsObject();
        dailyCashSum += sale.cash_paid;
        dailyDigitalSum += sale.card_paid;
        scrollContainer.innerHTML += `
            <div class="invoice-block">
                <p><strong>Invoice ID: #100${sale.id}</strong> [${sale.sale_timestamp}]</p>
                <p>Sold Items: ${sale.items_summary}</p>
                <p style="font-weight:600;">Billed: ₦${sale.total_billed.toFixed(2)} (Cash: ₦${sale.cash_paid.toFixed(2)} | Card/Transfer: ₦${sale.card_paid.toFixed(2)})</p>
            </div>`;
    }
    stmt.free();

    document.getElementById('summary-start-cash').innerText = STARTING_CASH_FLOAT.toLocaleString('en-US', {minimumFractionDigits:2});
    document.getElementById('summary-cash-sales').innerText = dailyCashSum.toLocaleString('en-US', {minimumFractionDigits:2});
    document.getElementById('summary-digital-sales').innerText = dailyDigitalSum.toLocaleString('en-US', {minimumFractionDigits:2});
}

function renderFinancialDashboardSummary() {
    const todayDateString = new Date().toISOString().slice(0, 10);
    const res = azuDatabase.exec(`SELECT SUM(cash_paid), SUM(card_paid) FROM sales_history WHERE sale_timestamp LIKE '${todayDateString}%'`);
    const cash = res[0].values[0][0] || 0;
    const digital = res[0].values[0][1] || 0;
    document.getElementById('fin-today-cash').innerText = cash.toFixed(2);
    document.getElementById('fin-today-digital').innerText = digital.toFixed(2);
}

function toggleRangeSelectionInputs() {
    const customDiv = document.getElementById('custom-range-inputs');
    customDiv.classList.toggle('view-hidden');
    const today = new Date();
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(today.getFullYear() - 2);
    document.getElementById('profit-end-date').value = today.toISOString().slice(0,10);
    document.getElementById('profit-start-date').value = twoYearsAgo.toISOString().slice(0,10);
}

function loadProfitReport(range) {
    document.getElementById('btn-range-day').classList.remove('active-range-btn');
    document.getElementById('btn-range-2years').classList.remove('active-range-btn');
    let query = "", titleLabel = "";
    
    if (range === 'day') {
        document.getElementById('btn-range-day').classList.add('active-range-btn');
        document.getElementById('custom-range-inputs').classList.add('view-hidden');
        titleLabel = "Profit For The Day So Far";
        const todayStr = new Date().toISOString().slice(0, 10);
        query = `SELECT SUM(total_profit) FROM sales_history WHERE sale_timestamp LIKE '${todayStr}%'`;
    } else if (range === 'range') {
        document.getElementById('btn-range-2years').classList.add('active-range-btn');
        const start = document.getElementById('profit-start-date').value + " 00:00:00";
        const end = document.getElementById('profit-end-date').value + " 23:59:59";
        titleLabel = `Profits From ${document.getElementById('profit-start-date').value} to ${document.getElementById('profit-end-date').value}`;
        query = `SELECT SUM(total_profit) FROM sales_history WHERE sale_timestamp >= '${start}' AND sale_timestamp <= '${end}'`;
    }

    const res = azuDatabase.exec(query);
    const calculatedProfitValue = (res[0] && res[0].values[0][0]) ? res[0].values[0][0] : 0;
    document.getElementById('profit-title-label').innerText = titleLabel;
    document.getElementById('fin-profit-value').innerText = calculatedProfitValue.toFixed(2);
}