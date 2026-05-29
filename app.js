// Paste your Supabase credentials here
let SUPABASE_URL = "https://jziyplltccxlvjltlbkz.supabase.co"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6aXlwbGx0Y2N4bHZqbHRsYmt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzkyMTAsImV4cCI6MjA5NTU1NTIxMH0.IC8SEyV7M2c097ZYGYIvmVc0-GFt1mLslIHCt0G56Tk";

// SELF-CORRECTING GUARD: Strips out any extra "/rest/v1" or trailing slashes to stop the invalid path error
if (SUPABASE_URL.endsWith("/rest/v1")) {
    SUPABASE_URL = SUPABASE_URL.replace("/rest/v1", "");
}
if (SUPABASE_URL.endsWith("/")) {
    SUPABASE_URL = SUPABASE_URL.slice(0, -1);
}

// Initialize the cloud driver safely with the cleaned URL
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let checkoutCart = [];
const STARTING_CASH_FLOAT = 50000.00;

// Initialize app data from cloud database instances instantly on app mount
document.addEventListener("DOMContentLoaded", () => {
    refreshAllViewsData();
    setTimeout(() => { if(document.getElementById('sales-search')) document.getElementById('sales-search').focus(); }, 100);
});

// --- CLOUD WRITE AND RE-MUTATION LAYERS ---

async function executeAddDrug(event) {
    event.preventDefault();
    const payload = {
        name: document.getElementById('add-field-name').value,
        cost_price: parseFloat(document.getElementById('add-field-cost').value),
        selling_price: parseFloat(document.getElementById('add-field-selling').value),
        quantity: parseInt(document.getElementById('add-field-qty').value),
        min_quantity: parseInt(document.getElementById('add-field-min').value)
    };

    const { error } = await _supabase.from('inventory').insert([payload]);
    if (error) return alert("Cloud write error: " + error.message);

    document.getElementById('add-drug-form').reset();
    routeToSubpage('drug-list');
}

async function executeUpdateDrug(event) {
    event.preventDefault();
    const id = document.getElementById('update-field-id').value;
    const payload = {
        name: document.getElementById('update-field-name').value,
        cost_price: parseFloat(document.getElementById('update-field-cost').value),
        selling_price: parseFloat(document.getElementById('update-field-selling').value),
        quantity: parseInt(document.getElementById('update-field-qty').value),
        min_quantity: parseInt(document.getElementById('update-field-min').value)
    };

    const { error } = await _supabase.from('inventory').update(payload).eq('id', id);
    if (error) return alert("Cloud update failed: " + error.message);

    routeToSubpage('drug-list');
}

async function executeDeleteDrug() {
    const id = document.getElementById('delete-field-id').value;
    const { error } = await _supabase.from('inventory').delete().eq('id', id);
    if (error) return alert("Cloud delete execution rejected: " + error.message);

    routeToSubpage('drug-list');
}

async function processCheckout() {
    if (checkoutCart.length === 0) return alert("Checkout rejected: Shopping basket empty.");
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
    let receiptItemsHTML = ''; 
    
    // Atomically decrement stock numbers for each item purchased in cloud matrix
    for (let item of checkoutCart) {
        const itemLineTotal = item.sellingPrice * item.currentQty;
        totalCost += (item.costPrice * item.currentQty);
        
        // Structured string format using pipes so history renderer can easily split lines
        summaryText += `${item.name} (${item.currentQty} x ₦${item.sellingPrice.toFixed(2)} = ₦${itemLineTotal.toFixed(2)}) | `;

        // HTML templates targeting instant rendering on checkout print container
        receiptItemsHTML += `
            <div style="display: flex; justify-content: space-between; margin: 4px 0; font-size: 0.9rem;">
                <span>${item.name} (x${item.currentQty})</span>
                <span>@ ₦${item.sellingPrice.toFixed(2)} = <strong>₦${itemLineTotal.toFixed(2)}</strong></span>
            </div>`;

        // Direct fallback client-side mutation calculation path bypassing missing RPC configurations
        const newQuantity = item.maxLimit - item.currentQty;
        const { error } = await _supabase.from('inventory').update({ quantity: newQuantity }).eq('id', item.id);
        if (error) console.error(`Stock update failed for item ID ${item.id}:`, error.message);
    }

    // Clean up trailing pipeline characters from base dataset summary array
    if (summaryText.endsWith(' | ')) {
        summaryText = summaryText.slice(0, -3);
    }

    const salePayload = {
        items_summary: summaryText,
        total_billed: grandTotal,
        cash_paid: cashComponent,
        card_paid: cardComponent,
        total_cost: totalCost,
        total_profit: (grandTotal - totalCost)
    };

    const { error: invoiceError } = await _supabase.from('sales_history').insert([salePayload]);
    if (invoiceError) return alert("Invoice processing error: " + invoiceError.message);

    // Apply the structural update layout variables inside the instant generation layout viewport
    document.getElementById('receipt-print-data').innerHTML = `
        <div class="receipt-paper-view" style="font-family: monospace; padding: 10px; color: #1e293b;">
            <h3 style="text-align: center; margin-bottom: 4px;">AZU PHARMACY RECEIPT</h3>
            <p style="font-size: 0.8rem; text-align: center; margin-bottom: 12px;">Date: ${new Date().toLocaleString()}</p>
            <div style="border-bottom: 1px dashed #94a3b8; margin-bottom: 8px;"></div>
            
            ${receiptItemsHTML}
            
            <div style="border-bottom: 1px dashed #94a3b8; margin-top: 8px; margin-bottom: 8px;"></div>
            <h4 style="display: flex; justify-content: space-between; margin: 6px 0; font-size: 1.1rem;">
                <span>TOTAL DUE:</span>
                <span>₦${grandTotal.toFixed(2)}</span>
            </h4>
            <p style="font-size:0.8rem; color: #64748b; text-align: center; margin-top: 8px;">
                Cash: ₦${cashComponent.toFixed(2)} | Card: ₦${cardComponent.toFixed(2)}
            </p>
        </div>`;
    
    document.getElementById('receipt-modal').classList.add('open');
    checkoutCart = [];
    refreshCartUI();
    refreshAllViewsData();
}

// --- CLOUD GLOBAL FETCH READ OPERATIONS ---

async function renderInventoryTable() {
    const searchFilter = document.getElementById('inventory-search-input').value;
    const tableBody = document.getElementById('inventory-main-table-body');
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Syncing global records...</td></tr>';

    let query = _supabase.from('inventory').select('*').order('name', { ascending: true });
    if (searchFilter) query = query.ilike('name', `%${searchFilter}%`);

    const { data: drugs, error } = await query;
    if (error) return console.error(error);

    tableBody.innerHTML = '';
    drugs.forEach(drug => {
        let restockCellContent = drug.quantity < drug.min_quantity ? `<span class="badge-danger-alert" style="color:red; font-weight:bold;">Restock needed</span>` : '';
        tableBody.innerHTML += `
            <tr>
                <td><div class="drug-name-click" style="cursor:pointer; color:#2563eb;" onclick="spawnPortalDropdown(event, ${drug.id})">${drug.name}</div></td>
                <td>₦${drug.cost_price.toFixed(2)}</td>
                <td>₦${drug.selling_price.toFixed(2)}</td>
                <td><strong>${drug.quantity}</strong></td>
                <td>${restockCellContent}</td>
            </tr>`;
    });
}

async function loadDrugsToBuyPage() {
    const tbody = document.getElementById('procurement-table-body');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Checking inventories...</td></tr>';
    
    // Fetch all records cleanly from the inventory table snapshot
    const { data: allItems, error } = await _supabase.from('inventory').select('*');
    
    if (error) {
        console.error("Error fetching inventory for procurement:", error);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Failed to sync stock data.</td></tr>';
        return;
    }

    // Securely check column metrics down inside the local machine context
    const filtered = allItems ? allItems.filter(d => d.quantity < d.min_quantity) : [];

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#64748b;">All stocks healthy!</td></tr>`;
        return routeToSubpage('drugs-to-buy');
    }

    filtered.forEach(drug => {
        tbody.innerHTML += `
            <tr>
                <td><strong>${drug.name}</strong></td>
                <td><span style="color:red; font-weight:bold;">${drug.quantity}</span></td>
                <td>${drug.min_quantity}</td>
                <td><input type="number" value="${drug.min_quantity - drug.quantity}" min="1" style="padding:6px;"></td>
            </tr>`;
    });
    routeToSubpage('drugs-to-buy');
}

async function searchSalesCounter() {
    const inputQuery = document.getElementById('sales-search').value;
    const dropContainer = document.getElementById('sales-dropdown-results');
    dropContainer.innerHTML = '';
    if (!inputQuery) return;

    const { data: matches } = await _supabase.from('inventory').select('*').ilike('name', `%${inputQuery}%`).order('name', {ascending: true});
    
    if(matches) {
        matches.forEach(drug => {
            const item = document.createElement('div');
            item.className = 'dropdown-entry-item';
            item.style.padding = "10px";
            item.style.cursor = "pointer";
            item.innerHTML = `💊 ${drug.name} — ₦${drug.selling_price.toFixed(2)} (${drug.quantity} left)`;
            item.onclick = () => { addItemToCart(drug); document.getElementById('sales-search').value = ''; dropContainer.innerHTML = ''; };
            dropContainer.appendChild(item);
        });
    }
}

async function loadViewDrugPage(id) {
    const { data: drug } = await _supabase.from('inventory').select('*').eq('id', id).single();
    if (!drug) return;
    document.getElementById('view-field-name').value = drug.name;
    document.getElementById('view-field-cost').value = `₦${drug.cost_price.toFixed(2)}`;
    document.getElementById('view-field-selling').value = `₦${drug.selling_price.toFixed(2)}`;
    document.getElementById('view-field-qty').value = `${drug.quantity} Units`;
    document.getElementById('view-field-min').value = `${drug.min_quantity} Units`;
    routeToSubpage('view-drug');
}

async function loadUpdateDrugPage(id) {
    const { data: drug } = await _supabase.from('inventory').select('*').eq('id', id).single();
    if (!drug) return;
    document.getElementById('update-field-id').value = drug.id;
    document.getElementById('update-field-name').value = drug.name;
    document.getElementById('update-field-cost').value = drug.cost_price;
    document.getElementById('update-field-selling').value = drug.selling_price;
    document.getElementById('update-field-qty').value = drug.quantity;
    document.getElementById('update-field-min').value = drug.min_quantity;
    routeToSubpage('update-drug');
}

async function loadDeleteDrugPage(id) {
    const { data: drug } = await _supabase.from('inventory').select('*').eq('id', id).single();
    if (!drug) return;
    document.getElementById('delete-field-id').value = drug.id;
    document.getElementById('delete-display-name').value = drug.name;
    routeToSubpage('delete-drug');
}

async function renderDailySalesHistoryPage() {
    const scrollContainer = document.getElementById('daily-invoices-scroll-area');
    if (!scrollContainer) return;
    scrollContainer.innerHTML = '<p style="text-align:center;">Syncing records...</p>';
    
    let dailyCashSum = 0, dailyDigitalSum = 0;
    const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";

    const { data: sales } = await _supabase.from('sales_history').select('*').gte('sale_timestamp', todayStart).order('id', {ascending: false});

    scrollContainer.innerHTML = '';
    if(sales) {
        sales.forEach(sale => {
            dailyCashSum += sale.cash_paid;
            dailyDigitalSum += sale.card_paid;

            // Decouple the summary text array values on the data channel pipeline
            const formattedItemsLines = sale.items_summary
                .split(' | ')
                .map(line => `<div style="padding-left: 10px; color: #475569; font-family: monospace; margin: 2px 0;">• ${line}</div>`)
                .join('');

            scrollContainer.innerHTML += `
                <div class="invoice-block" style="border-bottom:1px solid #cbd5e1; padding: 15px 0;">
                    <p style="margin-bottom: 6px;">
                        <strong>Invoice ID: #100${sale.id}</strong> 
                        <span style="color: #64748b; font-size: 0.85rem;">[${new Date(sale.sale_timestamp).toLocaleTimeString()}]</span>
                    </p>
                    
                    <div style="margin: 8px 0; background: #f8fafc; padding: 8px; border-radius: 4px; border-left: 3px solid #cbd5e1;">
                        ${formattedItemsLines}
                    </div>
                    
                    <p style="font-weight:600; margin-top: 6px; color: #0f172a; font-size: 1rem;">
                        Total Cost: <span style="color: #16a34a;">₦${sale.total_billed.toFixed(2)}</span>
                    </p>
                    <p style="font-size: 0.8rem; color: #64748b;">
                        Payment breakdown: Cash: ₦${sale.cash_paid.toFixed(2)} | Card/Transfer: ₦${sale.card_paid.toFixed(2)}
                    </p>
                </div>`;
        });
    }

    document.getElementById('summary-start-cash').innerText = STARTING_CASH_FLOAT.toLocaleString('en-US', {minimumFractionDigits:2});
    document.getElementById('summary-cash-sales').innerText = dailyCashSum.toLocaleString('en-US', {minimumFractionDigits:2});
    document.getElementById('summary-digital-sales').innerText = dailyDigitalSum.toLocaleString('en-US', {minimumFractionDigits:2});
}

async function renderFinancialDashboardSummary() {
    const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
    const { data: sales } = await _supabase.from('sales_history').select('cash_paid, card_paid').gte('sale_timestamp', todayStart);
    
    let cash = 0, digital = 0;
    if(sales) {
        sales.forEach(s => { cash += s.cash_paid; digital += s.card_paid; });
    }
    document.getElementById('fin-today-cash').innerText = cash.toFixed(2);
    document.getElementById('fin-today-digital').innerText = digital.toFixed(2);
}

async function loadProfitReport(range) {
    document.getElementById('btn-range-day').classList.remove('active-range-btn');
    document.getElementById('btn-range-2years').classList.remove('active-range-btn');
    let query = _supabase.from('sales_history').select('total_profit');
    let titleLabel = "";
    
    if (range === 'day') {
        document.getElementById('btn-range-day').classList.add('active-range-btn');
        document.getElementById('custom-range-inputs').classList.add('view-hidden');
        titleLabel = "Profit For The Day So Far";
        const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
        query = query.gte('sale_timestamp', todayStart);
    } else if (range === 'range') {
        document.getElementById('btn-range-2years').classList.add('active-range-btn');
        const start = document.getElementById('profit-start-date').value + "T00:00:00.000Z";
        const end = document.getElementById('profit-end-date').value + "T23:59:59.000Z";
        titleLabel = `Profits From ${document.getElementById('profit-start-date').value} to ${document.getElementById('profit-end-date').value}`;
        query = query.gte('sale_timestamp', start).lte('sale_timestamp', end);
    }

    const { data: profits } = await query;
    let calculatedProfitValue = 0;
    if(profits) profits.forEach(p => calculatedProfitValue += p.total_profit);

    document.getElementById('profit-title-label').innerText = titleLabel;
    document.getElementById('fin-profit-value').innerText = calculatedProfitValue.toFixed(2);
}

// --- STANDARD MENU PORTAL DROPDOWNS & WORKSPACE NAVIGATION ---

function spawnPortalDropdown(event, drugId) {
    event.stopPropagation();
    destroyExistingPortalDropdowns();
    const rect = event.target.getBoundingClientRect();
    const portal = document.createElement('div');
    portal.className = 'dropdown-menu-portal';
    portal.id = 'active-portal-dropdown';
    portal.style.position = 'absolute';
    portal.style.top = `${rect.bottom + window.scrollY}px`;
    portal.style.left = `${rect.left + window.scrollX}px`;
    portal.style.background = '#ffffff';
    portal.style.border = '1px solid #cbd5e1';
    portal.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1)';
    portal.style.zIndex = '999';
    portal.innerHTML = `
        <button style="display:block; width:100%; text-align:left; padding:8px 12px; background:none; border:none; cursor:pointer;" onclick="loadViewDrugPage(${drugId})">View drug details</button>
        <button style="display:block; width:100%; text-align:left; padding:8px 12px; background:none; border:none; cursor:pointer;" onclick="loadUpdateDrugPage(${drugId})">Update drug details</button>
        <button style="display:block; width:100%; text-align:left; padding:8px 12px; background:none; border:none; cursor:pointer; color:red;" onclick="loadDeleteDrugPage(${drugId})">Delete drug records</button>`;
    document.body.appendChild(portal);
}

function destroyExistingPortalDropdowns() {
    const existingPortal = document.getElementById('active-portal-dropdown');
    if(existingPortal) existingPortal.remove();
}
document.addEventListener('click', destroyExistingPortalDropdowns);

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
    ['subpage-drug-list', 'subpage-add-drug', 'subpage-view-drug', 'subpage-update-drug', 'subpage-delete-drug', 'subpage-drugs-to-buy'].forEach(id => document.getElementById(id).classList.add('view-hidden'));
    document.getElementById(`subpage-${subpageId}`).classList.remove('view-hidden');
    if (subpageId === 'drug-list') renderInventoryTable();
}

function addItemToCart(drug) {
    if(drug.quantity <= 0) return alert("Operation rejected: Out of stock.");
    const match = checkoutCart.find(r => r.id === drug.id);
    if(match) {
        if(match.currentQty >= drug.quantity) return alert("Operation rejected: Max stock reached.");
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

function toggleRangeSelectionInputs() {
    const customDiv = document.getElementById('custom-range-inputs');
    customDiv.classList.toggle('view-hidden');
    const today = new Date();
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(today.getFullYear() - 2);
    document.getElementById('profit-end-date').value = today.toISOString().slice(0,10);
    document.getElementById('profit-start-date').value = twoYearsAgo.toISOString().slice(0,10);
}