// db.js - Database operations for Limitless Apparel POS
import { supabase } from './supabase-client.js'

export class DatabaseManager {
    constructor() {
        console.log('DatabaseManager initialized')
    }

    // ==================== PRODUCTS ====================

    // Get all products
    async getProducts(filters = {}) {
        try {
            let query = supabase
                .from('products')
                .select('*')
                .order('name')

            // Apply filters
            if (filters.category && filters.category !== 'All') {
                query = query.eq('category', filters.category)
            }

            if (filters.search) {
                query = query.ilike('name', `%${filters.search}%`)
            }

            if (filters.activeOnly !== false) {
                query = query.eq('is_active', true)
            }

            const { data, error } = await query

            if (error) throw error
            return { success: true, data }
        } catch (error) {
            console.error('Error fetching products:', error)
            return { success: false, error: error.message }
        }
    }

    // Get single product by ID
    async getProductById(productId) {
        try {
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .eq('id', productId)
                .single()

            if (error) throw error
            return { success: true, data }
        } catch (error) {
            console.error('Error fetching product:', error)
            return { success: false, error: error.message }
        }
    }

    // Get product by barcode
    async getProductByBarcode(barcode) {
        try {
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .eq('barcode', barcode)
                .single()

            if (error) throw error
            return { success: true, data }
        } catch (error) {
            console.error('Error fetching product by barcode:', error)
            return { success: false, error: error.message }
        }
    }

    // Create new product
    async createProduct(productData) {
        try {
            const { data, error } = await supabase
                .from('products')
                .insert([{
                    name: productData.name,
                    category: productData.category,
                    price: parseFloat(productData.price),
                    cost_price: productData.cost_price ? parseFloat(productData.cost_price) : null,
                    stock_quantity: parseInt(productData.stock_quantity) || 0,
                    size: productData.size,
                    barcode: productData.barcode,
                    is_on_sale: productData.is_on_sale || false,
                    sale_price: productData.sale_price ? parseFloat(productData.sale_price) : null,
                    is_active: true
                }])
                .select()

            if (error) throw error

            // Create inventory transaction for initial stock
            if (parseInt(productData.stock_quantity) > 0) {
                await this.createInventoryTransaction({
                    product_id: data[0].id,
                    type: 'restock',
                    quantity: parseInt(productData.stock_quantity),
                    notes: 'Initial stock'
                })
            }

            return { success: true, data: data[0] }
        } catch (error) {
            console.error('Error creating product:', error)
            return { success: false, error: error.message }
        }
    }

    // Update product
    // In db.js - Check and fix the updateProduct method
    async updateProduct(productId, updates) {
        try {
            console.log('🔄 Updating product:', productId, updates)

            // Prepare update data
            const updateData = {
                ...updates,
                updated_at: new Date().toISOString()
            }

            // Handle numeric fields
            if (updateData.price) updateData.price = parseFloat(updateData.price)
            if (updateData.cost_price) updateData.cost_price = parseFloat(updateData.cost_price)
            if (updateData.stock_quantity !== undefined) updateData.stock_quantity = parseInt(updateData.stock_quantity)
            if (updateData.sale_price) updateData.sale_price = parseFloat(updateData.sale_price)

            console.log('📝 Update data:', updateData)

            const { data, error } = await supabase
                .from('products')
                .update(updateData)
                .eq('id', productId)
                .select()

            if (error) {
                console.error('❌ Error updating product:', error)
                throw error
            }

            console.log('✅ Product updated successfully:', data)
            return { success: true, data: data[0] }
        } catch (error) {
            console.error('❌ Error updating product:', error)
            return { success: false, error: error.message }
        }
    }

    // Delete product (soft delete)
    async deleteProduct(productId) {
        try {
            // Use the module-level supabase (not this.supabase)
            // Soft delete: mark is_active = false so we keep history
            const { data, error } = await supabase
                .from('products')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('id', productId)
                .select()

            if (error) throw error

            return { success: true, data: data[0] }
        } catch (error) {
            console.error('Error deleting product:', error)
            return { success: false, error: error.message }
        }
    }

    // ==================== SALES ====================

    // In db.js - FIXED createSale method
    async createSale(saleData) {
        try {
            // Get the current session FIRST
            const { data: { session }, error: sessionError } = await supabase.auth.getSession()

            if (sessionError) throw sessionError
            if (!session) throw new Error('User not authenticated')

            const user = session.user
            console.log('Creating sale for user:', user.id)

            // Start a transaction
            const sale = {
                cashier_id: user.id,
                total: parseFloat(saleData.total),
                payment_method: saleData.payment_method
            }

            // Create sale record
            const { data: saleRecord, error: saleError } = await supabase
                .from('sales')
                .insert([sale])
                .select()

            if (saleError) {
                console.error('Sale creation error:', saleError)
                throw saleError
            }

            const saleId = saleRecord[0].id
            console.log('Sale created with ID:', saleId)

            // Create sale items
            const saleItems = saleData.items.map(item => ({
                sale_id: saleId,
                product_id: item.id,
                product_name: item.name,
                quantity: parseInt(item.quantity),
                unit_price: parseFloat(item.price),
                total: parseFloat(item.price) * parseInt(item.quantity)
            }))

            const { error: itemsError } = await supabase
                .from('sale_items')
                .insert(saleItems)

            if (itemsError) {
                console.error('Sale items error:', itemsError)
                throw itemsError
            }

            // Update product stock and create inventory transactions
            for (const item of saleData.items) {
                // Update product stock
                const product = await this.getProductById(item.id)
                if (product.success) {
                    const newStock = product.data.stock_quantity - item.quantity
                    await this.updateProduct(item.id, { stock_quantity: newStock })

                    // Create inventory transaction
                    await this.createInventoryTransaction({
                        product_id: item.id,
                        type: 'sale',
                        quantity: -item.quantity, // Negative for sales
                        notes: `Sale ${saleId}`,
                        user_id: user.id // Explicitly pass user_id
                    })
                }
            }

            return {
                success: true,
                data: {
                    sale: saleRecord[0],
                    items: saleItems,
                    saleId: saleId
                }
            }
        } catch (error) {
            console.error('Error creating sale:', error)
            return { success: false, error: error.message }
        }
    }

    // Get sales with optional filters
    // In db.js - Update getSales method
    async getSales(filters = {}) {
        try {
            let query = supabase
                .from('sales')
                .select(`
                *,
                sale_items (*),
                users!cashier_id (full_name, email)
            `)
                .order('created_at', { ascending: false })

            // Date filters
            if (filters.startDate) {
                query = query.gte('created_at', filters.startDate)
            }
            if (filters.endDate) {
                query = query.lte('created_at', filters.endDate)
            }

            // Payment method filter
            if (filters.payment_method) {
                query = query.eq('payment_method', filters.payment_method)
            }

            const { data, error } = await query

            if (error) throw error
            return { success: true, data }
        } catch (error) {
            console.error('Error fetching sales:', error)
            return { success: false, error: error.message }
        }
    }

    // Also update getTodaySales method
    async getTodaySales() {
        try {
            const today = new Date()
            today.setHours(0, 0, 0, 0)

            const { data, error } = await supabase
                .from('sales')
                .select(`
                *,
                sale_items (*),
                users!cashier_id (full_name, email)
            `)
                .gte('created_at', today.toISOString())
                .order('created_at', { ascending: false })

            if (error) throw error
            return { success: true, data }
        } catch (error) {
            console.error('Error fetching today sales:', error)
            return { success: false, error: error.message }
        }
    }

    // ==================== INVENTORY ====================

    // In db.js - FIXED createInventoryTransaction method
    async createInventoryTransaction(transactionData) {
        try {
            // Get the current session
            const { data: { session }, error: sessionError } = await supabase.auth.getSession()

            if (sessionError) throw sessionError
            if (!session) throw new Error('User not authenticated')

            const user = session.user

            const transaction = {
                product_id: transactionData.product_id,
                type: transactionData.type,
                quantity: parseInt(transactionData.quantity),
                user_id: user.id, // Use the authenticated user's ID
                notes: transactionData.notes
            }

            const { data, error } = await supabase
                .from('inventory_transactions')
                .insert([transaction])
                .select()

            if (error) throw error
            return { success: true, data: data[0] }
        } catch (error) {
            console.error('Error creating inventory transaction:', error)
            return { success: false, error: error.message }
        }
    }

    // Get inventory transactions for a product
    async getProductTransactions(productId, limit = 50) {
        try {
            const { data, error } = await supabase
                .from('inventory_transactions')
                .select(`
          *,
          users:user_id (full_name),
          products:product_id (name)
        `)
                .eq('product_id', productId)
                .order('created_at', { ascending: false })
                .limit(limit)

            if (error) throw error
            return { success: true, data }
        } catch (error) {
            console.error('Error fetching product transactions:', error)
            return { success: false, error: error.message }
        }
    }

    // Restock product
    async restockProduct(productId, quantity, notes = '') {
        try {
            // Get current product
            const product = await this.getProductById(productId)
            if (!product.success) throw new Error('Product not found')

            const newStock = product.data.stock_quantity + parseInt(quantity)

            // Update product stock
            await this.updateProduct(productId, { stock_quantity: newStock })

            // Create inventory transaction
            await this.createInventoryTransaction({
                product_id: productId,
                type: 'restock',
                quantity: parseInt(quantity),
                notes: notes || `Restocked ${quantity} units`
            })

            return { success: true, newStock }
        } catch (error) {
            console.error('Error restocking product:', error)
            return { success: false, error: error.message }
        }
    }

    // ==================== ANALYTICS & REPORTS ====================

    // Get sales analytics
    async getSalesAnalytics(dateRange = 'month') {
        try {
            let startDate = new Date()

            switch (dateRange) {
                case 'today':
                    startDate.setHours(0, 0, 0, 0)
                    break
                case 'week':
                    startDate.setDate(startDate.getDate() - 7)
                    break
                case 'month':
                    startDate.setMonth(startDate.getMonth() - 1)
                    break
                case 'year':
                    startDate.setFullYear(startDate.getFullYear() - 1)
                    break
                default:
                    startDate.setMonth(startDate.getMonth() - 1)
            }

            // Total sales
            const { data: salesData, error: salesError } = await supabase
                .from('sales')
                .select('total, payment_method')
                .gte('created_at', startDate.toISOString())

            if (salesError) throw salesError

            // Product sales
            const { data: productSalesData, error: productSalesError } = await supabase
                .from('sale_items')
                .select(`
          quantity,
          unit_price,
          total,
          products (name, category)
        `)
                .gte('created_at', startDate.toISOString())

            if (productSalesError) throw productSalesError

            // Calculate analytics
            const totalSales = salesData.reduce((sum, sale) => sum + parseFloat(sale.total), 0)
            const totalOrders = salesData.length
            const avgOrder = totalOrders > 0 ? totalSales / totalOrders : 0

            const cashSales = salesData
                .filter(sale => sale.payment_method === 'Cash')
                .reduce((sum, sale) => sum + parseFloat(sale.total), 0)

            const transferSales = salesData
                .filter(sale => sale.payment_method === 'Transfer')
                .reduce((sum, sale) => sum + parseFloat(sale.total), 0)

            // Product performance
            const productPerformance = {}
            productSalesData.forEach(item => {
                const productName = item.products.name
                if (!productPerformance[productName]) {
                    productPerformance[productName] = {
                        name: productName,
                        category: item.products.category,
                        quantity: 0,
                        revenue: 0
                    }
                }
                productPerformance[productName].quantity += item.quantity
                productPerformance[productName].revenue += parseFloat(item.total)
            })

            const topProducts = Object.values(productPerformance)
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5)

            // Category performance
            const categoryPerformance = {}
            productSalesData.forEach(item => {
                const category = item.products.category
                if (!categoryPerformance[category]) {
                    categoryPerformance[category] = 0
                }
                categoryPerformance[category] += parseFloat(item.total)
            })

            return {
                success: true,
                data: {
                    totalSales,
                    totalOrders,
                    avgOrder,
                    cashSales,
                    transferSales,
                    topProducts,
                    categoryPerformance,
                    dateRange
                }
            }
        } catch (error) {
            console.error('Error fetching sales analytics:', error)
            return { success: false, error: error.message }
        }
    }

    // Get inventory summary
    async getInventorySummary() {
        try {
            const { data: products, error } = await supabase
                .from('products')
                .select('stock_quantity, price, cost_price')
                .eq('is_active', true)

            if (error) throw error

            const totalInventory = products.reduce((sum, product) => sum + product.stock_quantity, 0)
            const totalStockValue = products.reduce((sum, product) =>
                sum + (product.stock_quantity * parseFloat(product.price)), 0
            )
            const totalCostValue = products.reduce((sum, product) =>
                sum + (product.stock_quantity * parseFloat(product.cost_price || 0)), 0
            )

            const lowStockItems = products.filter(product => product.stock_quantity < 10)
            const outOfStockItems = products.filter(product => product.stock_quantity === 0)

            return {
                success: true,
                data: {
                    totalInventory,
                    totalStockValue,
                    totalCostValue,
                    lowStockCount: lowStockItems.length,
                    outOfStockCount: outOfStockItems.length,
                    lowStockItems: lowStockItems.map(p => ({
                        name: p.name,
                        stock: p.stock_quantity
                    }))
                }
            }
        } catch (error) {
            console.error('Error fetching inventory summary:', error)
            return { success: false, error: error.message }
        }
    }

    // ==================== UTILITY METHODS ====================

    // Get categories
    async getCategories() {
        try {
            const { data, error } = await supabase
                .from('products')
                .select('category')
                .eq('is_active', true)

            if (error) throw error

            const categories = [...new Set(data.map(item => item.category))]
            return { success: true, data: categories }
        } catch (error) {
            console.error('Error fetching categories:', error)
            return { success: false, error: error.message }
        }
    }

    // Check if barcode exists
    async checkBarcodeExists(barcode, excludeProductId = null) {
        try {
            let query = supabase
                .from('products')
                .select('id')
                .eq('barcode', barcode)
                .eq('is_active', true)

            if (excludeProductId) {
                query = query.neq('id', excludeProductId)
            }

            const { data, error } = await query

            if (error) throw error
            return { success: true, exists: data.length > 0 }
        } catch (error) {
            console.error('Error checking barcode:', error)
            return { success: false, error: error.message }
        }
    }
}

// Create global database instance
export const db = new DatabaseManager()