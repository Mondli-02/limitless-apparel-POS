// admin.js - Manager Dashboard Logic
import { authManager } from './auth.js'
import { categoryConfig } from './category-config.js';
import { db } from './db.js'

class AdminApp {
    constructor() {
        this.products = []
        this.sales = []
        this.analytics = null
        this.currentTab = 'analytics'
        this.initializeDeleteModal();
        this.iconCache = new Map();
        this.iconsLoaded = false;
        this.init()
    }

    async init() {
        console.log('🔧 Admin App Initializing...')

        // Check authentication
        const hasSession = await authManager.init()
        if (!hasSession) {
            console.log('❌ No valid session, redirecting to login...')
            window.location.href = 'index.html'
            return
        }

        // Verify manager role
        const userRole = await authManager.getCurrentUserRole()
        if (userRole !== 'manager') {
            console.log('❌ Unauthorized access, redirecting...')
            alert('Access denied. Manager privileges required.')
            await authManager.logout()
            return
        }

        console.log('✅ Manager authenticated')

        await this.preloadIcons();

        // Setup event listeners
        this.setupEventListeners()

        // Load initial data
        await this.loadAnalytics()
        await this.loadProducts()

        console.log('✅ Admin App Ready!')
    }

    async preloadIcons() {
        console.log('🔄 Preloading category icons...');

        const loadPromises = Object.entries(categoryConfig).map(async ([category, config]) => {
            try {
                const response = await fetch(config.icon);
                if (response.ok) {
                    const svgText = await response.text();
                    this.iconCache.set(category, svgText);
                    console.log(`✅ Loaded icon for ${category}`);
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                console.warn(`❌ Could not load icon for ${category}:`, error);
                // Fallback to placeholder
                this.iconCache.set(category, this.createFallbackIcon(category, config));
            }
        });

        await Promise.all(loadPromises);
        this.iconsLoaded = true;
        console.log('✅ All icons loaded');
    }

    // Create fallback icon (text in colored circle)
    createFallbackIcon(category, config) {
        return `
            <div class="category-icon-fallback" 
                 style="background: ${config.lightColor}; color: ${config.color};">
                ${category.charAt(0)}
            </div>
        `;
    }

    // Update the getCategoryIcon method to use the same logic as POS
    getCategoryIcon(category) {
        if (!this.iconsLoaded) {
            // Return simple fallback if icons aren't loaded yet
            const config = categoryConfig[category] || categoryConfig['Shirts'];
            return this.createFallbackIcon(category, config);
        }

        return this.iconCache.get(category) || this.createFallbackIcon(category, categoryConfig[category]);
    }

    setupEventListeners() {
        // Logout button
        document.querySelector('.logout-btn').addEventListener('click', async () => {
            await authManager.logout()
        })

        // Tab navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab
                this.switchTab(tabName)
            })
        })

        // Add product button
        document.getElementById('addProductBtn')?.addEventListener('click', () => {
            this.openAddProductModal()
        })

        // Close modal
        document.getElementById('closeModal')?.addEventListener('click', () => {
            this.closeModal()
        })

        // Modal cancel button
        document.querySelector('.modal-footer .btn-secondary')?.addEventListener('click', () => {
            this.closeModal()
        })

        // Modal submit button
        document.querySelector('.modal-footer .btn-primary')?.addEventListener('click', () => {
            this.handleProductSubmit()
        })

        // Inventory search
        document.querySelector('#inventoryTab .search-input')?.addEventListener('input', (e) => {
            this.filterInventory(e.target.value)
        })

        // Sales filters
        document.querySelectorAll('#salesTab .filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#salesTab .filter-btn').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
                this.filterSales(btn.textContent.trim())
            })
        })

        // Sales search
        document.querySelector('#salesTab .search-input')?.addEventListener('input', (e) => {
            this.searchSales(e.target.value)
        })

        // Reports date range
        document.querySelectorAll('.quick-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.quick-filter').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
                this.loadReports(btn.textContent.trim())
            })
        })

        // Export report button
        document.querySelector('#reportsTab .btn-full')?.addEventListener('click', () => {
            this.exportReport()
        })
    }

    initializeDeleteModal() {
        this.deleteModal = document.getElementById('confirmDeleteModal');
        this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        this.pendingDeleteId = null;

        this.cancelDeleteBtn.addEventListener('click', () => {
            this.closeDeleteModal();
        });

        this.confirmDeleteBtn.addEventListener('click', async () => {
            if (this.pendingDeleteId) {
                await this.deleteProduct(this.pendingDeleteId);
            }
            this.closeDeleteModal();
        });
    }

    openDeleteModal(productId) {
        this.pendingDeleteId = productId;
        this.deleteModal.classList.add('active');
    }

    closeDeleteModal() {
        this.deleteModal.classList.remove('active');
        this.pendingDeleteId = null;
    }


    switchTab(tabName) {
        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'))
        document.querySelector(`.nav-btn[data-tab="${tabName}"]`).classList.add('active')

        // Update content
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'))
        document.getElementById(`${tabName}Tab`).classList.add('active')

        this.currentTab = tabName

        // Load tab-specific data
        if (tabName === 'analytics') {
            this.loadAnalytics()
        } else if (tabName === 'inventory') {
            this.loadProducts()
        } else if (tabName === 'sales') {
            this.loadSales()
        } else if (tabName === 'reports') {
            this.loadReports('This Month')
        }
    }

    // ==================== ANALYTICS TAB ====================

    async loadAnalytics() {
        try {
            console.log('📊 Loading analytics...')

            const result = await db.getSalesAnalytics('month')

            if (result.success) {
                this.analytics = result.data
                this.updateAnalyticsUI()
            } else {
                console.error('Error loading analytics:', result.error)
            }

            // Also load low stock alerts
            await this.loadLowStockAlerts()

        } catch (error) {
            console.error('Error in loadAnalytics:', error)
        }
    }

    async updateAnalyticsUI() {
        if (!this.analytics) return

        // Update stat cards
        const statCards = document.querySelectorAll('#analyticsTab .stat-card')

        // Stat Card 1: Total Revenue
        if (statCards[0]) {
            statCards[0].querySelector('.stat-value').textContent =
                `${this.analytics.totalSales.toFixed(2)}`
        }

        // Stat Card 2: Today's Sales
        if (statCards[1]) {
            const todayResult = await db.getTodaySales()
            if (todayResult.success) {
                const todayTotal = todayResult.data.reduce((sum, sale) => sum + parseFloat(sale.total), 0)
                statCards[1].querySelector('.stat-value').textContent = `${todayTotal.toFixed(2)}`
            }
        }

        // Stat Card 3: Total Sales (number of orders)
        if (statCards[2]) {
            statCards[2].querySelector('.stat-value').textContent = this.analytics.totalOrders
        }

        // Stat Card 4: Total Value of Stock Remaining
        if (statCards[3]) {
            const inventoryResult = await db.getInventorySummary()
            if (inventoryResult.success) {
                statCards[3].querySelector('.stat-value').textContent =
                    `${inventoryResult.data.totalStockValue.toFixed(2)}`
            }
        }

        // Update top products
        this.renderTopProducts()
    }

    renderTopProducts() {
        if (!this.analytics?.topProducts) return

        const container = document.querySelector('#analyticsTab .card')
        const productsHTML = this.analytics.topProducts.map((product, index) => {
            const icon = this.getCategoryIcon(product.category) // Now uses the improved icon method
            return `
                <div class="top-product">
                    <div class="top-product-rank">${index + 1}</div>
                    <div class="top-product-icon">${icon}</div>
                    <div class="top-product-info">
                        <div class="top-product-name">${product.name}</div>
                        <div class="top-product-category">${product.category}</div>
                    </div>
                    <div class="top-product-stats">
                        <div class="top-product-revenue">$${product.revenue.toFixed(2)}</div>
                        <div class="top-product-sold">${product.quantity} sold</div>
                    </div>
                </div>
            `
        }).join('')

        const existingContent = container.querySelector('.section-header').outerHTML
        container.innerHTML = existingContent + productsHTML
    }

    async loadLowStockAlerts() {
        try {
            const result = await db.getProducts({ activeOnly: true })

            if (result.success) {
                // Low stock: 1-10 items
                const lowStockItems = result.data
                    .filter(p => p.stock_quantity > 0 && p.stock_quantity <= 10)
                    .slice(0, 3)

                // Out of stock items
                const outOfStockItems = result.data
                    .filter(p => p.stock_quantity === 0)
                    .slice(0, 3)

                this.renderLowStockAlerts(lowStockItems, outOfStockItems)
            }
        } catch (error) {
            console.error('Error loading low stock alerts:', error)
        }
    }

    renderLowStockAlerts(lowStockItems, outOfStockItems = []) {
        const alertBox = document.querySelector('.alert-box')
        if (!alertBox) return

        // If no alerts at all
        if (lowStockItems.length === 0 && outOfStockItems.length === 0) {
            alertBox.style.background = '#d1fae5'
            alertBox.style.borderColor = '#a7f3d0'
            alertBox.innerHTML = `
            <div class="alert-header" style="color: var(--success);">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span>All Stock Levels Good</span>
            </div>
            <div style="padding: 8px 0; font-size: 14px; color: var(--success);">
                No items are currently low on stock. All inventory levels are healthy.
            </div>
        `
            return
        }

        // Build alert content
        let alertContent = ''
        let alertColor = ''
        let alertTitle = ''

        if (outOfStockItems.length > 0) {
            // Priority: Out of stock is more critical
            alertColor = 'danger'
            alertTitle = 'Out of Stock Alert'
            alertContent = outOfStockItems.map(item => `
            <div class="alert-item">
                <span class="alert-item-name">${item.name}</span>
                <span class="alert-item-stock" style="color: var(--danger);">Out of Stock</span>
            </div>
        `).join('')
        } else if (lowStockItems.length > 0) {
            // Only low stock items
            alertColor = 'warning'
            alertTitle = 'Low Stock Alert'
            alertContent = lowStockItems.map(item => `
            <div class="alert-item">
                <span class="alert-item-name">${item.name}</span>
                <span class="alert-item-stock" style="color: var(--warning);">${item.stock_quantity} left</span>
            </div>
        `).join('')
        }

        alertBox.style.background = alertColor === 'danger' ? '#fef2f2' : '#fffbeb'
        alertBox.style.borderColor = alertColor === 'danger' ? '#fecaca' : '#fed7aa'

        alertBox.innerHTML = `
        <div class="alert-header" style="color: var(--${alertColor});">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
            <span>${alertTitle}</span>
        </div>
        ${alertContent}
    `
    }

    // ==================== INVENTORY TAB ====================

    async loadProducts() {
        try {
            console.log('📦 Loading products...')

            const result = await db.getProducts({ activeOnly: true })

            if (result.success) {
                this.products = result.data
                this.renderInventory()
            } else {
                console.error('Error loading products:', result.error)
            }

        } catch (error) {
            console.error('Error in loadProducts:', error)
        }
    }

    renderInventory(filteredProducts = null) {
        const products = filteredProducts || this.products
        const container = document.querySelector('#inventoryTab .search-box').parentElement

        // Remove old inventory items
        container.querySelectorAll('.inventory-item').forEach(item => item.remove())

        products.forEach(product => {
            const item = this.createInventoryItemElement(product)
            container.appendChild(item)
        })
    }

    createInventoryItemElement(product) {
        const div = document.createElement('div');
        div.className = 'inventory-item';
        div.setAttribute('data-category', product.category);

        if (product.stock_quantity <= 10) {
            div.classList.add('low-stock');
        }

        const badgeClass =
            product.stock_quantity > 10 ? 'badge-success' :
                product.stock_quantity > 0 ? 'badge-warning' : 'badge-danger';
        const badgeText =
            product.stock_quantity > 10 ? 'In Stock' :
                product.stock_quantity > 0 ? 'Low Stock' : 'Out of Stock';

        const icon = this.getCategoryIcon(product.category);

        // Handle null values by providing defaults
        const priceValue = product.price || 0;
        const stockValue = product.stock_quantity || 0;
        const sizeValue = product.size || '-';
        const barcodeValue = product.barcode || '-';

        div.innerHTML = `
    <div class="inventory-header">
        <div class="category-icon">${icon}</div>
        <div class="inventory-info">
            <div class="inventory-name">${product.name}</div>
            <div class="inventory-meta">${product.category} • ${sizeValue} • ${barcodeValue}</div>
            <span class="inventory-badge ${badgeClass}">${badgeText}</span>
        </div>
    </div>

    <div class="inventory-edit">
        <div class="edit-field">
            <label>Price ($)</label>
            <input type="number" data-field="price" value="${priceValue}" step="0.01" min="0" />
        </div>
        <div class="edit-field">
            <label>Stock Qty</label>
            <input type="number" data-field="stock_quantity" value="${stockValue}" min="0" />
        </div>
        <div class="action-buttons">
            <button class="btn-icon save-btn" title="Save">
                <img src="./icons/ui/save.svg" alt="Save" />
                <div class="spinner"></div>
            </button>
            <button class="btn-icon delete-btn" title="Delete">
                <img src="./icons/ui/delete.svg" alt="Delete" />
                <div class="spinner"></div>
            </button>
        </div>
    </div>
`;

        // Select elements
        const saveBtn = div.querySelector('.save-btn');
        const deleteBtn = div.querySelector('.delete-btn');

        const saveIcon = saveBtn.querySelector('img');
        const saveSpinner = saveBtn.querySelector('.spinner');

        const deleteIcon = deleteBtn.querySelector('img');
        const deleteSpinner = deleteBtn.querySelector('.spinner');

        // --- Save button logic ---
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            saveIcon.style.display = 'none';
            saveSpinner.style.display = 'block';

            await this.saveProductChanges(product.id, div);

            saveSpinner.style.display = 'none';
            saveIcon.style.display = 'block';
            saveBtn.disabled = false;
        });

        // --- Delete button logic ---
        deleteBtn.addEventListener('click', () => {
            this.openDeleteModal(product.id);
        });


        return div;
    }


    async saveProductChanges(productId, element) {
        try {
            const stockInput = element.querySelector('[data-field="stock_quantity"]')
            const priceInput = element.querySelector('[data-field="price"]')

            const updates = {
                stock_quantity: parseInt(stockInput.value),
                price: parseFloat(priceInput.value)
            }

            console.log('💾 Saving product changes:', productId, updates)

            const result = await db.updateProduct(productId, updates)

            if (result.success) {
                this.showToast('Product updated successfully!', 'success')
                await this.loadProducts()
                await this.loadAnalytics()
            } else {
                throw new Error(result.error)
            }

        } catch (error) {
            console.error('Error saving product:', error)
            this.showToast('Error updating product', 'error')
        }
    }

    async deleteProduct(productId) {
        try {
            console.log("🗑️ Deleting product:", productId);

            // Use the db module directly instead of trying to access supabase
            const result = await db.deleteProduct(productId);

            if (result.success) {
                this.showToast('Product deleted successfully!', 'success');

                // Refresh the inventory list and analytics
                await this.loadProducts();
                await this.loadAnalytics();
            } else {
                throw new Error(result.error);
            }

        } catch (error) {
            console.error("Error deleting product:", error);
            this.showToast('Error deleting product', 'error');
        }
    }


    filterInventory(searchTerm) {
        if (!searchTerm) {
            this.renderInventory()
            return
        }

        const searchLower = searchTerm.toLowerCase()
        const filtered = this.products.filter(product =>
            product.name.toLowerCase().includes(searchLower) ||
            product.category.toLowerCase().includes(searchLower) ||
            product.barcode.toLowerCase().includes(searchLower)
        )

        this.renderInventory(filtered)
    }

    // ==================== MODAL ====================

    openAddProductModal() {
        document.getElementById('addProductModal').classList.add('active')
        this.clearProductForm()
    }

    closeModal() {
        document.getElementById('addProductModal').classList.remove('active')
    }

    clearProductForm() {
        const form = document.querySelector('#addProductModal .modal-body')
        form.querySelectorAll('input, select').forEach(input => {
            input.value = ''
        })
    }

    async handleProductSubmit() {
        try {
            const form = document.querySelector('#addProductModal .modal-body')

            const productData = {
                name: form.querySelector('input[placeholder*="Blue Cotton"]').value,
                category: form.querySelector('select').value,
                size: form.querySelector('input[placeholder*="M, L"]').value,
                barcode: form.querySelector('input[placeholder*="LIM013"]').value,
                price: form.querySelector('input[placeholder="0.00"]').value,
                cost_price: form.querySelectorAll('input[placeholder="0.00"]')[1].value,
                stock_quantity: form.querySelector('input[placeholder="0"]').value
            }

            // Validate
            if (!productData.name || !productData.category || !productData.price) {
                this.showToast('Please fill in all required fields', 'error')
                return
            }

            console.log('➕ Creating product:', productData)

            const result = await db.createProduct(productData)

            if (result.success) {
                this.showToast('Product added successfully!', 'success')
                this.closeModal()
                await this.loadProducts()
                await this.loadAnalytics()
            } else {
                throw new Error(result.error)
            }

        } catch (error) {
            console.error('Error creating product:', error)
            this.showToast('Error adding product', 'error')
        }
    }

    // ==================== SALES TAB ====================

    async loadSales(filter = 'All') {
        try {
            console.log('💰 Loading sales...', filter)

            let result
            const today = new Date()
            today.setHours(0, 0, 0, 0)

            switch (filter) {
                case 'Today':
                    result = await db.getTodaySales()
                    break
                case 'This Week':
                    const weekStart = new Date(today)
                    weekStart.setDate(today.getDate() - 7)
                    result = await db.getSales({ startDate: weekStart.toISOString() })
                    break
                case 'This Month':
                    const monthStart = new Date(today)
                    monthStart.setMonth(today.getMonth() - 1)
                    result = await db.getSales({ startDate: monthStart.toISOString() })
                    break
                case 'Cash':
                    result = await db.getSales({ payment_method: 'Cash' })
                    break
                case 'Transfer':
                    result = await db.getSales({ payment_method: 'Transfer' })
                    break
                default:
                    result = await db.getSales()
            }

            if (result.success) {
                this.sales = result.data
                this.renderSales()
            }

        } catch (error) {
            console.error('Error loading sales:', error)
        }
    }

    renderSales(filteredSales = null) {
        const sales = filteredSales || this.sales
        const container = document.querySelector('#salesTab .search-box').parentElement

        // Remove old sale cards
        container.querySelectorAll('.sale-card').forEach(card => card.remove())

        sales.forEach(sale => {
            const card = this.createSaleCardElement(sale)
            container.appendChild(card)
        })
    }

    createSaleCardElement(sale) {
        const div = document.createElement('div')
        div.className = 'sale-card'

        const saleDate = new Date(sale.created_at)
        const formattedDate = saleDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })

        const paymentBadgeClass = sale.payment_method === 'Cash' ? 'payment-cash' : 'payment-transfer'
        const saleItems = sale.sale_items || []
        const cashierName = sale.users?.full_name || 'Unknown'

        div.innerHTML = `
            <div class="sale-header">
                <div>
                    <div class="sale-id">Order #${sale.id.slice(-4)}</div>
                    <div class="sale-date">${formattedDate} • ${cashierName}</div>
                </div>
                <span class="sale-payment-badge ${paymentBadgeClass}">${sale.payment_method}</span>
            </div>
            <div class="sale-items">
                ${saleItems.map(item => `
                    <div class="sale-item-row">
                        <span>${item.product_name} x${item.quantity}</span>
                        <span>$${parseFloat(item.total).toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
            <div class="sale-footer">
                <span>Total</span>
                <span>$${parseFloat(sale.total).toFixed(2)}</span>
            </div>
        `

        return div
    }

    filterSales(filter) {
        this.loadSales(filter)
    }

    searchSales(searchTerm) {
        if (!searchTerm) {
            this.renderSales()
            return
        }

        const searchLower = searchTerm.toLowerCase()
        const filtered = this.sales.filter(sale =>
            sale.id.toLowerCase().includes(searchLower) ||
            sale.payment_method.toLowerCase().includes(searchLower) ||
            sale.users?.full_name?.toLowerCase().includes(searchLower)
        )

        this.renderSales(filtered)
    }

    // ==================== REPORTS TAB ====================

    async loadReports(period) {
        try {
            console.log('📈 Loading reports for:', period)

            let dateRange = 'month'
            switch (period) {
                case 'Today':
                    dateRange = 'today'
                    break
                case 'Yesterday':
                case 'Last 7 Days':
                    dateRange = 'week'
                    break
                case 'This Month':
                    dateRange = 'month'
                    break
                case 'Last Month':
                    dateRange = 'month'
                    break
            }

            const result = await db.getSalesAnalytics(dateRange)

            if (result.success) {
                this.updateReportsUI(result.data)
            }

        } catch (error) {
            console.error('Error loading reports:', error)
        }
    }

    updateReportsUI(data) {
        // Update summary cards
        const summaryCards = document.querySelectorAll('#reportsTab .summary-card')

        if (summaryCards[0]) {
            summaryCards[0].querySelector('.summary-value').textContent = `$${data.totalSales.toFixed(2)}`
        }
        if (summaryCards[1]) {
            summaryCards[1].querySelector('.summary-value').textContent = data.totalOrders
        }
        if (summaryCards[2]) {
            summaryCards[2].querySelector('.summary-value').textContent = `$${data.cashSales.toFixed(2)}`
        }
        if (summaryCards[3]) {
            summaryCards[3].querySelector('.summary-value').textContent = `$${data.transferSales.toFixed(2)}`
        }

        // Update category performance
        this.renderCategoryPerformance(data.categoryPerformance)
    }

    renderCategoryPerformance(categoryData) {
        const container = document.querySelector('.category-performance')
        if (!container) return

        const categoriesHTML = Object.entries(categoryData).map(([category, amount]) => `
            <div class="category-row">
                <span class="category-name">${category}</span>
                <span class="category-amount">$${amount.toFixed(2)}</span>
            </div>
        `).join('')

        const header = container.querySelector('.section-header').outerHTML
        container.innerHTML = header + categoriesHTML
    }

    exportReport() {
        try {
            // Create CSV content
            let csv = 'Category,Revenue\n'

            if (this.analytics?.categoryPerformance) {
                Object.entries(this.analytics.categoryPerformance).forEach(([category, amount]) => {
                    csv += `${category},$${amount.toFixed(2)}\n`
                })
            }

            // Create download link
            const blob = new Blob([csv], { type: 'text/csv' })
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `sales-report-${new Date().toISOString().split('T')[0]}.csv`
            a.click()
            window.URL.revokeObjectURL(url)

            this.showToast('Report exported successfully!', 'success')

        } catch (error) {
            console.error('Error exporting report:', error)
            this.showToast('Error exporting report', 'error')
        }
    }

    // ==================== UTILITIES ====================


    showToast(message, type = 'info') {
        const toast = document.createElement('div')
        const backgroundColor =
            type === 'success' ? 'var(--success)' :
                type === 'error' ? 'var(--danger)' :
                    'var(--primary)'

        toast.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: ${backgroundColor};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            animation: slideIn 0.3s ease;
            max-width: 300px;
        `
        toast.textContent = message

        document.body.appendChild(toast)

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease'
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast)
                }
            }, 300)
        }, 3000)
    }
}

// Add CSS animations for toasts
const style = document.createElement('style')
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`
document.head.appendChild(style)

// Initialize the admin app
const adminApp = new AdminApp()

// Make it globally available
window.adminApp = adminApp