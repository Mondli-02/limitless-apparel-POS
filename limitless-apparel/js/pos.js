// pos.js - POS Application Logic
import { authManager } from './auth.js'
import { categoryConfig } from './category-config.js';
import { db } from './db.js'

// POS Application State
class POSApp {
    constructor() {
        this.products = [];
        this.cart = [];
        this.categories = [];
        this.currentCategory = "All";
        this.searchTerm = "";
        this.isProcessingSale = false;

        this.iconCache = new Map();
        this.iconsLoaded = false;

        this.init();
    }

    async init() {
        console.log("POS App Initializing...");

        // Wait for Supabase session check
        const hasSession = await authManager.init();

        if (!hasSession) {
            console.log("No valid session found, redirecting to login...");
            window.location.href = "index.html";
            return;
        }

        await this.preloadIcons();

        // Setup event listeners
        this.setupEventListeners();
        this.setupInventoryEvents();
        this.setupSalesEvents();
        this.setupProfileEvents();

        // Load initial data
        await this.loadCategories();
        await this.loadProducts();

        console.log("POS App Ready!");
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

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll(".nav-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Cart modal
        document
            .getElementById("cartFab")
            .addEventListener("click", () => this.openCart());
        document
            .getElementById("closeCart")
            .addEventListener("click", () => this.closeCart());
        document
            .getElementById("clearCart")
            .addEventListener("click", () => this.clearCart());

        // Payment buttons
        document
            .getElementById("cashPayment")
            .addEventListener("click", () => this.processPayment("Cash"));
        document
            .getElementById("transferPayment")
            .addEventListener("click", () => this.processPayment("Transfer"));

        // Search
        document
            .getElementById("searchInput")
            .addEventListener("input", (e) => {
                this.searchTerm = e.target.value;
                this.filterProducts();
            });
    }

    // Add these methods to your POSApp class

    // Load profile data
    async loadProfile() {
        try {
            console.log('👤 Loading profile data...')

            const user = authManager.getCurrentUser()
            const profile = authManager.getUserProfile()

            if (user && profile) {
                this.updateProfileUI(user, profile)
                await this.updateProfileStats()
            } else {
                console.error('User or profile data not available')
            }

        } catch (error) {
            console.error('Error loading profile:', error)
        }
    }

    // Update profile UI with user data
    updateProfileUI(user, profile) {
        // User information
        document.getElementById('profileUserName').textContent = profile.full_name || 'Shopkeeper'
        document.getElementById('profileUserRole').textContent = this.formatRole(profile.role)
        document.getElementById('profileUserEmail').textContent = user.email

        // Session information
        document.getElementById('loginTime').textContent = new Date().toLocaleTimeString()
        document.getElementById('deviceInfo').textContent = this.getDeviceInfo()
        document.getElementById('connectionStatus').textContent = navigator.onLine ? 'Online' : 'Offline'
    }

    // Format role for display
    formatRole(role) {
        return role === 'shopkeeper' ? 'Shopkeeper' :
            role === 'manager' ? 'Manager' : role
    }

    // Get device information
    getDeviceInfo() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        return isMobile ? 'Mobile' : 'Desktop'
    }

    // Replace the updateProfileStats method in pos.html with this:

    async updateProfileStats() {
        try {
            console.log('📊 Updating profile stats...')

            // IMPORTANT: Ensure products are loaded first
            if (!this.products || this.products.length === 0) {
                console.log('⚠️ Products not loaded, loading now...')
                await this.loadProducts()
            }

            console.log('📦 Total products loaded:', this.products.length)

            // Get today's sales for stats
            const todayResult = await db.getTodaySales()

            if (todayResult.success) {
                const todaySales = todayResult.data
                const salesCount = todaySales.length
                const revenueToday = todaySales.reduce((sum, sale) => sum + parseFloat(sale.total), 0)

                document.getElementById('profileSalesCount').textContent = salesCount
                document.getElementById('profileRevenueToday').textContent = `$${revenueToday.toFixed(2)}`
            }

            // Debug: Log all products with their stock levels
            console.log('🔍 Checking stock levels:')
            this.products.forEach(product => {
                console.log(`   📦 ${product.name}: ${product.stock_quantity} in stock`)
                if (product.stock_quantity > 0 && product.stock_quantity <= 10) {
                    console.log(`      ⚠️ LOW STOCK ALERT!`)
                }
            })

            // Calculate low stock items (stock > 0 AND stock <= 10)
            const lowStockItems = this.products.filter(p => {
                const isLowStock = p.stock_quantity > 0 && p.stock_quantity <= 10
                return isLowStock
            })

            const lowStockCount = lowStockItems.length

            console.log('📊 Low stock items found:', lowStockCount)
            console.log('📋 Low stock products:', lowStockItems.map(p => `${p.name} (${p.stock_quantity})`))

            // Update the UI
            const lowStockAlertElement = document.getElementById('lowStockAlertCount')
            if (lowStockAlertElement) {
                lowStockAlertElement.textContent = lowStockCount
                console.log('✅ Updated UI with low stock alert count:', lowStockCount)
            } else {
                console.error('❌ Could not find lowStockAlertCount element')
            }

        } catch (error) {
            console.error('❌ Error updating profile stats:', error)
        }
    }

    // Also update the loadProfile method to ensure it waits for products:
    async loadProfile() {
        try {
            console.log('👤 Loading profile data...')

            const user = authManager.getCurrentUser()
            const profile = authManager.getUserProfile()

            if (user && profile) {
                this.updateProfileUI(user, profile)

                // CRITICAL: Ensure products are loaded before updating stats
                if (!this.products || this.products.length === 0) {
                    console.log('⚠️ Products not loaded in profile, loading now...')
                    await this.loadProducts()
                }

                // Now update stats
                await this.updateProfileStats()
            } else {
                console.error('❌ User or profile data not available')
            }

        } catch (error) {
            console.error('❌ Error loading profile:', error)
        }
    }
    // Setup profile event listeners
    setupProfileEvents() {
        // Refresh data button
        document.getElementById('refreshDataBtn').addEventListener('click', async () => {
            await this.refreshAllData()
        })

        // View all sales button
        document.getElementById('viewAllSalesBtn').addEventListener('click', () => {
            this.switchTab('sales')
            this.loadSales('all')
        })

        // Low stock alerts button
        document.getElementById('lowStockAlertBtn').addEventListener('click', () => {
            this.switchTab('inventory')
            document.querySelector('[data-filter="low"]').click()
        })

        // Logout button
        document.getElementById('profileLogoutBtn').addEventListener('click', async () => {
            await authManager.logout()
        })
    }

    // Refresh all data
    async refreshAllData() {
        try {
            console.log('🔄 Refreshing all data...')

            // Show loading state
            this.showToast('Refreshing data...', 'info')

            // Reload all data
            await this.loadProducts()
            await this.updateProfileStats()

            // Update inventory if we're on that tab
            if (document.getElementById('inventoryTab').classList.contains('active')) {
                this.loadInventory()
            }

            // Update sales if we're on that tab
            if (document.getElementById('salesTab').classList.contains('active')) {
                const activeFilter = document.querySelector('[data-sales-filter].active')
                if (activeFilter) {
                    this.loadSales(activeFilter.dataset.salesFilter)
                }
            }

            this.showToast('Data refreshed successfully!', 'success')

        } catch (error) {
            console.error('Error refreshing data:', error)
            this.showToast('Error refreshing data', 'error')
        }
    }

    // Update online/offline status
    updateConnectionStatus() {
        const statusElement = document.getElementById('connectionStatus')
        if (navigator.onLine) {
            statusElement.textContent = 'Online'
            statusElement.style.color = 'var(--success)'
        } else {
            statusElement.textContent = 'Offline'
            statusElement.style.color = 'var(--danger)'
        }
    }

    // Add these methods to your POSApp class

    // Load sales data
    async loadSales(filter = 'today') {
        try {
            console.log('💰 Loading sales data...', filter)
            document.getElementById('salesLoading').classList.remove('hidden')
            document.getElementById('noSales').classList.add('hidden')

            let salesData = []

            switch (filter) {
                case 'today':
                    const todayResult = await db.getTodaySales()
                    if (todayResult.success) {
                        salesData = todayResult.data
                    }
                    break
                case 'week':
                    const weekResult = await db.getSales({
                        startDate: this.getStartOfWeek().toISOString()
                    })
                    if (weekResult.success) {
                        salesData = weekResult.data
                    }
                    break
                case 'cash':
                    const cashResult = await db.getSales({
                        payment_method: 'Cash'
                    })
                    if (cashResult.success) {
                        salesData = cashResult.data
                    }
                    break
                case 'transfer':
                    const transferResult = await db.getSales({
                        payment_method: 'Transfer'
                    })
                    if (transferResult.success) {
                        salesData = transferResult.data
                    }
                    break
                default:
                    const allResult = await db.getSales()
                    if (allResult.success) {
                        salesData = allResult.data
                    }
            }

            this.sales = salesData
            this.updateSalesStats()
            this.renderSales()

        } catch (error) {
            console.error('Error loading sales:', error)
            document.getElementById('noSales').classList.remove('hidden')
        } finally {
            document.getElementById('salesLoading').classList.add('hidden')
        }
    }

    // Update sales statistics
    updateSalesStats() {
        if (!this.sales.length) {
            // Reset stats if no sales
            document.getElementById('todaySalesTotal').textContent = '$0.00'
            document.getElementById('todaySalesCount').textContent = '0'
            document.getElementById('cashSalesTotal').textContent = '$0.00'
            document.getElementById('transferSalesTotal').textContent = '$0.00'
            return
        }

        const today = new Date().toDateString()
        const todaySales = this.sales.filter(sale =>
            new Date(sale.created_at).toDateString() === today
        )

        const todayTotal = todaySales.reduce((sum, sale) => sum + parseFloat(sale.total), 0)
        const todayCount = todaySales.length

        const cashSales = this.sales.filter(sale => sale.payment_method === 'Cash')
        const cashTotal = cashSales.reduce((sum, sale) => sum + parseFloat(sale.total), 0)

        const transferSales = this.sales.filter(sale => sale.payment_method === 'Transfer')
        const transferTotal = transferSales.reduce((sum, sale) => sum + parseFloat(sale.total), 0)

        document.getElementById('todaySalesTotal').textContent = `$${todayTotal.toFixed(2)}`
        document.getElementById('todaySalesCount').textContent = todayCount
        document.getElementById('cashSalesTotal').textContent = `$${cashTotal.toFixed(2)}`
        document.getElementById('transferSalesTotal').textContent = `$${transferTotal.toFixed(2)}`
    }

    // Render sales items
    // In pos.html - Update renderSales method
    renderSales() {
        const container = document.getElementById('salesList')

        if (this.sales.length === 0) {
            document.getElementById('noSales').classList.remove('hidden')
            container.innerHTML = ''
            return
        }

        document.getElementById('noSales').classList.add('hidden')

        // Sort sales by date (newest first)
        const sortedSales = this.sales.sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        )

        container.innerHTML = sortedSales.map(sale => {
            const saleDate = new Date(sale.created_at)
            const formattedDate = saleDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })

            const paymentBadgeClass = sale.payment_method === 'Cash' ? 'payment-cash' : 'payment-transfer'

            // Check if sale_items exists and has data
            const saleItems = sale.sale_items || []
            const hasItems = saleItems.length > 0

            return `
            <div class="sale-card">
                <div class="sale-header">
                    <div>
                        <div class="sale-id">Sale #${sale.id.slice(-4)}</div>
                        <div class="sale-date">${formattedDate}</div>
                    </div>
                    <span class="sale-payment-badge ${paymentBadgeClass}">${sale.payment_method}</span>
                </div>
                <div class="sale-items">
                    ${hasItems
                    ? saleItems.map(item => `
                            <div class="sale-item-row">
                                <span>${item.product_name} x${item.quantity}</span>
                                <span>$${parseFloat(item.total).toFixed(2)}</span>
                            </div>
                        `).join('')
                    : `<div class="sale-item-row">
                            <span>Loading items...</span>
                            <span>$${parseFloat(sale.total).toFixed(2)}</span>
                           </div>`
                }
                </div>
                <div class="sale-footer">
                    <span>Total</span>
                    <span>$${parseFloat(sale.total).toFixed(2)}</span>
                </div>
            </div>
        `
        }).join('')
    }


    // Get start of week (for week filter)
    getStartOfWeek() {
        const now = new Date()
        const startOfWeek = new Date(now)
        startOfWeek.setDate(now.getDate() - now.getDay())
        startOfWeek.setHours(0, 0, 0, 0)
        return startOfWeek
    }

    // Setup sales event listeners
    setupSalesEvents() {
        // Sales filters
        document.querySelectorAll('[data-sales-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-sales-filter]').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
                this.loadSales(btn.dataset.salesFilter)
            })
        })

        // Sales search
        document.getElementById('salesSearch').addEventListener('input', (e) => {
            this.filterSales(e.target.value)
        })
    }

    // Filter sales by search term
    filterSales(searchTerm) {
        if (!searchTerm) {
            this.renderSales()
            return
        }

        const searchLower = searchTerm.toLowerCase()
        const filteredSales = this.sales.filter(sale => {
            const saleId = sale.id.toLowerCase()
            const saleTotal = sale.total.toString()
            const paymentMethod = sale.payment_method.toLowerCase()

            return saleId.includes(searchLower) ||
                saleTotal.includes(searchLower) ||
                paymentMethod.includes(searchLower)
        })

        this.renderFilteredSales(filteredSales)
    }

    // Render filtered sales
    renderFilteredSales(filteredSales) {
        const container = document.getElementById('salesList')

        if (filteredSales.length === 0) {
            document.getElementById('noSales').classList.remove('hidden')
            container.innerHTML = ''
            return
        }

        document.getElementById('noSales').classList.add('hidden')

        container.innerHTML = filteredSales.map(sale => {
            const saleDate = new Date(sale.created_at)
            const formattedDate = saleDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })

            const paymentBadgeClass = sale.payment_method === 'Cash' ? 'payment-cash' : 'payment-transfer'
            const saleItems = sale.sale_items || []

            return `
            <div class="sale-card">
                <div class="sale-header">
                    <div>
                        <div class="sale-id">Sale #${sale.id.slice(-4)}</div>
                        <div class="sale-date">${formattedDate}</div>
                    </div>
                    <span class="sale-payment-badge ${paymentBadgeClass}">${sale.payment_method}</span>
                </div>
                <div class="sale-items">
                    ${saleItems.length > 0
                    ? saleItems.map(item => `
                            <div class="sale-item-row">
                                <span>${item.product_name} x${item.quantity}</span>
                                <span>$${(parseFloat(item.unit_price) * item.quantity).toFixed(2)}</span>
                            </div>
                        `).join('')
                    : `<div class="sale-item-row">
                            <span>Items not available</span>
                            <span>$${parseFloat(sale.total).toFixed(2)}</span>
                           </div>`
                }
                </div>
                <div class="sale-footer">
                    <span>Total</span>
                    <span>$${parseFloat(sale.total).toFixed(2)}</span>
                </div>
            </div>
        `
        }).join('')
    }
    async loadInventory() {
        try {
            console.log("📦 Loading inventory data...");
            document
                .getElementById("inventoryLoading")
                .classList.remove("hidden");
            document.getElementById("noInventoryItems").classList.add("hidden");

            // Use the same products data we already have
            this.updateInventoryStats();
            this.renderInventoryItems();
        } catch (error) {
            console.error("Error loading inventory:", error);
            document
                .getElementById("noInventoryItems")
                .classList.remove("hidden");
        } finally {
            document.getElementById("inventoryLoading").classList.add("hidden");
        }
    }

    // Update inventory statistics
    updateInventoryStats() {
        if (!this.products.length) return;

        const totalInventory = this.products.reduce(
            (sum, product) => sum + product.stock_quantity,
            0
        );
        const inStockCount = this.products.filter(
            (p) => p.stock_quantity > 10
        ).length;
        const lowStockCount = this.products.filter(
            (p) => p.stock_quantity > 0 && p.stock_quantity <= 10
        ).length;
        const outOfStockCount = this.products.filter(
            (p) => p.stock_quantity === 0
        ).length;

        document.getElementById("totalInventory").textContent =
            totalInventory;
        document.getElementById("inStockCount").textContent = inStockCount;
        document.getElementById("lowStockCount").textContent = lowStockCount;
        document.getElementById("outOfStockCount").textContent =
            outOfStockCount;
    }

    // Render inventory items
    renderInventoryItems(filter = "all") {
        const container = document.getElementById("inventoryList");
        let filteredProducts = this.products;

        // Apply filters
        switch (filter) {
            case "low":
                filteredProducts = this.products.filter(
                    (p) => p.stock_quantity > 0 && p.stock_quantity <= 10
                );
                break;
            case "out":
                filteredProducts = this.products.filter(
                    (p) => p.stock_quantity === 0
                );
                break;
            case "in-stock":
                filteredProducts = this.products.filter(
                    (p) => p.stock_quantity > 10
                );
                break;
            default:
                filteredProducts = this.products;
        }

        if (filteredProducts.length === 0) {
            document
                .getElementById("noInventoryItems")
                .classList.remove("hidden");
            container.innerHTML = "";
            return;
        }

        document.getElementById("noInventoryItems").classList.add("hidden");

        container.innerHTML = filteredProducts
            .map((product) => {
                const stockStatus =
                    product.stock_quantity === 0
                        ? "out-of-stock"
                        : product.stock_quantity <= 10
                            ? "low-stock"
                            : "";

                const badgeClass =
                    product.stock_quantity === 0
                        ? "badge-danger"
                        : product.stock_quantity <= 10
                            ? "badge-warning"
                            : "badge-success";

                const badgeText =
                    product.stock_quantity === 0
                        ? "Out of Stock"
                        : product.stock_quantity <= 10
                            ? "Low Stock"
                            : "In Stock";

                const icon = this.getCategoryIcon(product.category);

                return `
            <div class="inventory-item ${stockStatus}">
                <div class="inventory-header">
                    <div class="inventory-icon">${icon}</div>
                    <div class="inventory-info">
                        <div class="inventory-name">${product.name}</div>
                        <div class="inventory-meta">${product.category} • ${product.size} • ${product.barcode}</div>
                        <span class="inventory-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="inventory-stock">
                        <div class="stock-value">${product.stock_quantity}</div>
                        <div class="stock-label">in stock</div>
                    </div>
                </div>
            </div>
        `;
            })
            .join("");
    }

    // Setup inventory event listeners
    setupInventoryEvents() {
        // Inventory search
        document
            .getElementById("inventorySearch")
            .addEventListener("input", (e) => {
                this.filterInventoryItems(e.target.value);
            });

        // Inventory filters
        document.querySelectorAll(".filter-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                document
                    .querySelectorAll(".filter-btn")
                    .forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                this.renderInventoryItems(btn.dataset.filter);
            });
        });
    }

    // Filter inventory items by search term
    filterInventoryItems(searchTerm) {
        if (!searchTerm) {
            const activeFilter =
                document.querySelector(".filter-btn.active").dataset.filter;
            this.renderInventoryItems(activeFilter);
            return;
        }

        const searchLower = searchTerm.toLowerCase();
        const filteredProducts = this.products.filter(
            (product) =>
                product.name.toLowerCase().includes(searchLower) ||
                product.category.toLowerCase().includes(searchLower) ||
                product.barcode.toLowerCase().includes(searchLower)
        );

        this.renderFilteredInventoryItems(filteredProducts);
    }

    // Render filtered inventory items
    renderFilteredInventoryItems(filteredProducts) {
        const container = document.getElementById("inventoryList");

        if (filteredProducts.length === 0) {
            document
                .getElementById("noInventoryItems")
                .classList.remove("hidden");
            container.innerHTML = "";
            return;
        }

        document.getElementById("noInventoryItems").classList.add("hidden");

        container.innerHTML = filteredProducts
            .map((product) => {
                const stockStatus =
                    product.stock_quantity === 0
                        ? "out-of-stock"
                        : product.stock_quantity <= 10
                            ? "low-stock"
                            : "";

                const badgeClass =
                    product.stock_quantity === 0
                        ? "badge-danger"
                        : product.stock_quantity <= 10
                            ? "badge-warning"
                            : "badge-success";

                const badgeText =
                    product.stock_quantity === 0
                        ? "Out of Stock"
                        : product.stock_quantity <= 10
                            ? "Low Stock"
                            : "In Stock";

                const icon = this.getCategoryIcon(product.category);

                return `
            <div class="inventory-item ${stockStatus}">
                <div class="inventory-header">
                    <div class="inventory-icon">${icon}</div>
                    <div class="inventory-info">
                        <div class="inventory-name">${product.name}</div>
                        <div class="inventory-meta">${product.category} • ${product.size} • ${product.barcode}</div>
                        <span class="inventory-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="inventory-stock">
                        <div class="stock-value">${product.stock_quantity}</div>
                        <div class="stock-label">in stock</div>
                    </div>
                </div>
            </div>
        `;
            })
            .join("");
    }

    async loadCategories() {
        try {
            const result = await db.getCategories();
            if (result.success) {
                this.categories = ["All", ...result.data];
                this.renderCategories();
            }
        } catch (error) {
            console.error("Error loading categories:", error);
        }
    }

    renderCategories() {
        const container = document.getElementById("categoryFilters");
        container.innerHTML = this.categories
            .map(
                (category) => `
                    <button class="category-btn ${category === this.currentCategory ? "active" : ""
                    }" 
                            data-category="${category}">
                        ${category}
                    </button>
                `
            )
            .join("");

        // Add category filter event listeners
        container.querySelectorAll(".category-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                this.currentCategory = btn.dataset.category;
                this.renderCategories();
                this.filterProducts();
            });
        });
    }
    // Update the loadProducts method to trigger updates
    async loadProducts() {
        try {
            console.log('🔄 Loading products...')
            document.getElementById('loadingProducts').classList.remove('hidden')
            document.getElementById('noProducts').classList.add('hidden')

            const result = await db.getProducts({ activeOnly: true })

            console.log('📦 Products loaded:', result)

            if (result.success) {
                this.products = result.data
                console.log('✅ Products array updated with', this.products.length, 'products')

                // Update dependent data
                this.filterProducts()

                // Update profile stats if profile tab is active
                if (document.getElementById('profileTab').classList.contains('active')) {
                    await this.updateProfileStats()
                }

                // Update inventory if inventory tab is active
                if (document.getElementById('inventoryTab').classList.contains('active')) {
                    this.loadInventory()
                }

            } else {
                console.error('❌ Error loading products:', result.error)
                throw new Error(result.error)
            }
        } catch (error) {
            console.error('❌ Error in loadProducts:', error)
            document.getElementById('noProducts').classList.remove('hidden')
        } finally {
            document.getElementById('loadingProducts').classList.add('hidden')
            console.log('🏁 loadProducts completed')
        }
    }

    filterProducts() {
        let filteredProducts = this.products;

        // Apply category filter
        if (this.currentCategory !== "All") {
            filteredProducts = filteredProducts.filter(
                (product) => product.category === this.currentCategory
            );
        }

        // Apply search filter
        if (this.searchTerm) {
            const searchLower = this.searchTerm.toLowerCase();
            filteredProducts = filteredProducts.filter(
                (product) =>
                    product.name.toLowerCase().includes(searchLower) ||
                    product.barcode.toLowerCase().includes(searchLower)
            );
        }

        this.renderProducts(filteredProducts);
    }

    renderProducts(products) {
        const container = document.getElementById('productsGrid');

        if (products.length === 0) {
            document.getElementById('noProducts').classList.remove('hidden');
            container.innerHTML = '';
            return;
        }

        document.getElementById('noProducts').classList.add('hidden');

        // Render products with category styling
        container.innerHTML = products.map(product => {
            const isOutOfStock = product.stock_quantity === 0;
            const stockClass = product.stock_quantity < 5 ? 'critical' :
                product.stock_quantity < 10 ? 'low' : '';

            return `
            <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}" 
                 data-category="${product.category}"
                 onclick="posApp.addToCart('${product.id}')">
                <div class="category-icon">
                    ${this.getCategoryIcon(product.category)}
                </div>
                <div class="product-name">${product.name}</div>
                <div class="product-meta">${product.category} • ${product.size}</div>
                <div class="product-footer">
                    <div class="product-price">$${parseFloat(product.price).toFixed(2)}</div>
                    <div class="product-stock ${stockClass}">
                        Stock: ${product.stock_quantity}
                    </div>
                </div>
            </div>
        `;
        }).join('');
    }
    getCategoryIcon(category) {
        if (!this.iconsLoaded) {
            // Return simple fallback if icons aren't loaded yet
            const config = categoryConfig[category] || categoryConfig['Shirts'];
            return this.createFallbackIcon(category, config);
        }

        return this.iconCache.get(category) || this.createFallbackIcon(category, categoryConfig[category]);
    }


    addToCart(productId) {
        const product = this.products.find((p) => p.id === productId);
        if (!product || product.stock_quantity === 0) return;

        const existingItem = this.cart.find((item) => item.id === productId);

        if (existingItem) {
            if (existingItem.quantity < product.stock_quantity) {
                existingItem.quantity++;
            } else {
                alert("Not enough stock!");
                return;
            }
        } else {
            this.cart.push({
                id: product.id,
                name: product.name,
                price: parseFloat(product.price),
                icon: this.getCategoryIcon(product.category),
                quantity: 1,
                maxQuantity: product.stock_quantity,
            });
        }

        this.updateCartUI();
        this.showAddToCartToast(product.name);
    }

    // Add this method for toast notifications
    showAddToCartToast(productName) {
        // Create toast element
        const toast = document.createElement("div");
        toast.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: var(--success);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease;
    `;
        toast.textContent = `✓ Added ${productName} to cart`;

        document.body.appendChild(toast);

        // Remove toast after 2 seconds
        setTimeout(() => {
            toast.style.animation = "slideOut 0.3s ease";
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 2000);
    }

    updateCartItemQuantity(productId, newQuantity) {
        if (newQuantity <= 0) {
            this.removeFromCart(productId);
            return;
        }

        const cartItem = this.cart.find((item) => item.id === productId);
        if (cartItem && newQuantity <= cartItem.maxQuantity) {
            cartItem.quantity = newQuantity;
            this.updateCartUI();
        } else {
            alert("Not enough stock!");
        }
    }

    removeFromCart(productId) {
        this.cart = this.cart.filter((item) => item.id !== productId);
        this.updateCartUI();
    }

    updateCartUI() {
        const cartCount = document.getElementById("cartCount");
        const cartTotal = document.getElementById("cartTotal");
        const cartItems = document.getElementById("cartItems");
        const cartEmpty = document.getElementById("cartEmpty");
        const cartFooter = document.getElementById("cartFooter");
        const cartBadge = document.getElementById("cartBadge");

        const totalItems = this.cart.reduce(
            (sum, item) => sum + item.quantity,
            0
        );
        const totalAmount = this.cart.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
        );

        cartCount.textContent = totalItems;
        cartTotal.textContent = `$${totalAmount.toFixed(2)}`;

        if (totalItems > 0) {
            cartBadge.textContent = totalItems;
            cartBadge.classList.remove("hidden");
        } else {
            cartBadge.classList.add("hidden");
        }

        if (this.cart.length === 0) {
            cartItems.classList.add("hidden");
            cartEmpty.classList.remove("hidden");
            cartFooter.classList.add("hidden");
        } else {
            cartItems.classList.remove("hidden");
            cartEmpty.classList.add("hidden");
            cartFooter.classList.remove("hidden");

            cartItems.innerHTML = this.cart
                .map(
                    (item) => `
                        <div class="cart-item">
                            <div class="cart-item-icon">${item.icon}</div>
                            <div class="cart-item-details">
                                <div class="cart-item-name">${item.name}</div>
                                <div class="cart-item-price">$${item.price.toFixed(
                        2
                    )}</div>
                                <div class="cart-item-controls">
                                    <button class="qty-btn" onclick="posApp.updateCartItemQuantity('${item.id
                        }', ${item.quantity - 1})">-</button>
                                    <span class="qty-value">${item.quantity
                        }</span>
                                    <button class="qty-btn" onclick="posApp.updateCartItemQuantity('${item.id
                        }', ${item.quantity + 1})">+</button>
                                    <button class="remove-btn" onclick="posApp.removeFromCart('${item.id
                        }')">
                                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `
                )
                .join("");
        }
    }

    openCart() {
        document.getElementById("cartModal").classList.add("active");
    }

    closeCart() {
        document.getElementById("cartModal").classList.remove("active");
    }

    clearCart() {
        this.cart = [];
        this.updateCartUI();
        this.closeCart();
    }

    // In pos.html - Update processPayment method
    // In pos.html - Update the processPayment method
    async processPayment(paymentMethod) {
        if (this.isProcessingSale) return;

        this.isProcessingSale = true;
        this.setPaymentButtonsLoading(true, paymentMethod);

        try {
            console.log("Processing payment:", paymentMethod);
            console.log("Cart items:", this.cart);

            const saleData = {
                items: this.cart,
                total: this.cart.reduce(
                    (sum, item) => sum + item.price * item.quantity,
                    0
                ),
                payment_method: paymentMethod,
            };

            console.log("Sale data:", saleData);

            const result = await db.createSale(saleData);

            console.log("Sale result:", result);

            if (result.success) {
                // Show success message
                this.showSuccessToast(
                    `Sale completed! Total: $${saleData.total.toFixed(2)}`
                );

                // Clear cart and close modal
                this.clearCart();
                this.closeCart();

                // IMPORTANT: Reload products to get updated stock levels
                await this.loadProducts();

                console.log("Products reloaded with updated stock levels");
            } else {
                throw new Error(result.error || "Unknown error occurred");
            }
        } catch (error) {
            console.error("Payment processing error:", error);
            this.showErrorToast("Error processing sale: " + error.message);
        } finally {
            this.isProcessingSale = false;
            this.setPaymentButtonsLoading(false);
        }
    }

    // Add these helper methods for better user feedback
    showSuccessToast(message) {
        this.showToast(message, "success");
    }

    showErrorToast(message) {
        this.showToast(message, "error");
    }

    showToast(message, type = "info") {
        const toast = document.createElement("div");
        const backgroundColor =
            type === "success"
                ? "var(--success)"
                : type === "error"
                    ? "var(--danger)"
                    : "var(--primary)";

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
    `;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Remove toast after 3 seconds
        setTimeout(() => {
            toast.style.animation = "slideOut 0.3s ease";
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    setPaymentButtonsLoading(loading, activeMethod = null) {
        const cashBtn = document.getElementById("cashPayment");
        const transferBtn = document.getElementById("transferPayment");
        const cashText = document.getElementById("cashText");
        const transferText = document.getElementById("transferText");
        const cashSpinner = document.getElementById("cashSpinner");
        const transferSpinner = document.getElementById("transferSpinner");

        if (loading) {
            cashBtn.disabled = true;
            transferBtn.disabled = true;

            if (activeMethod === "Cash") {
                cashText.style.display = "none";
                cashSpinner.style.display = "inline-block";
            } else if (activeMethod === "Transfer") {
                transferText.style.display = "none";
                transferSpinner.style.display = "inline-block";
            }
        } else {
            cashBtn.disabled = false;
            transferBtn.disabled = false;
            cashText.style.display = "inline-block";
            transferText.style.display = "inline-block";
            cashSpinner.style.display = "none";
            transferSpinner.style.display = "none";
        }
    }

    // Update the switchTab method
    switchTab(tabName) {
        // Remove active class from all nav buttons and tab contents
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'))
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'))

        // Add active class to selected tab
        document.querySelector(`.nav-btn[data-tab="${tabName}"]`).classList.add('active')
        document.getElementById(`${tabName}Tab`).classList.add('active')

        // Show/hide cart FAB based on current tab
        const cartFab = document.getElementById('cartFab')
        if (tabName === 'pos') {
            cartFab.style.display = 'flex' // Show cart FAB
        } else {
            cartFab.style.display = 'none' // Hide cart FAB
            this.closeCart() // Also close cart modal if open
        }

        // Load tab-specific data
        if (tabName === 'inventory') {
            this.loadInventory()
        } else if (tabName === 'sales') {
            this.loadSales('today')
        } else if (tabName === 'profile') {
            this.loadProfile()
            this.updateProfileStats() // Force stats update
        }
    }
}
// Initialize the POS app
const posApp = new POSApp();

// Make it globally available for onclick handlers
window.posApp = posApp;
