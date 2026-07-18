const swaggerJsdoc = require('swagger-jsdoc');

// The `dishes` table/route name is inherited from the café this store was forked
// from. It holds grocery products here; the public wording says "product".
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'GardenMarket API',
      version: '1.0.0',
      description: 'REST API for the GardenMarket QR storefront (grocery shop)',
    },
    servers: [{ url: 'http://localhost:3100', description: 'Development' }],
    components: {
      securitySchemes: {
        AdminPassword: {
          type: 'apiKey',
          in: 'header',
          name: 'x-admin-password',
          description: 'Admin password (default: admin123)',
        },
      },
      schemas: {
        Category: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string', description: 'JSON string with lang keys, e.g. {"en":"Vegetables","az":"Tərəvəz"}' },
            icon: { type: 'string', example: '🥬' },
            icon_type: { type: 'string', enum: ['svg', 'emoji', 'image'], default: 'svg' },
            icon_key: { type: 'string', nullable: true, description: 'Named SVG icon key, e.g. vegetables' },
            icon_url: { type: 'string', nullable: true, description: 'Uploaded icon URL (Cloudinary or /uploads/...)' },
            sort_order: { type: 'integer' },
            is_active: { type: 'integer', enum: [0, 1] },
          },
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            category_id: { type: 'integer' },
            name: { type: 'string', description: 'JSON string with lang keys' },
            description: { type: 'string', description: 'JSON string with lang keys' },
            ingredients: { type: 'string', nullable: true, description: 'JSON string with lang keys; null for raw produce' },
            price: { type: 'number', description: 'Price per `unit`, in AZN' },
            old_price: { type: 'number', nullable: true },
            unit: { type: 'string', enum: ['kg', 'piece', 'pack', 'bunch'], default: 'piece', description: 'Unit of sale — what one quantity step means' },
            stock_qty: { type: 'number', nullable: true, description: 'Units in stock. null = not tracked; 0 = out of stock' },
            sku: { type: 'string', nullable: true, description: 'Internal article code / barcode' },
            weight: { type: 'integer', nullable: true, description: 'Typical unit weight in grams (1000 for kg-priced items)' },
            calories: { type: 'integer', nullable: true, description: 'Per 100 g' },
            protein: { type: 'number', nullable: true, description: 'Per 100 g' },
            fat: { type: 'number', nullable: true, description: 'Per 100 g' },
            carbs: { type: 'number', nullable: true, description: 'Per 100 g' },
            allergens: { type: 'string', description: 'JSON array string' },
            sizes: { type: 'string', description: 'JSON array of pack variants, e.g. [{"label":"1 kq","price":4.5},{"label":"5 kq","price":21}]. Empty [] means no variants; `price` then applies.' },
            image: { type: 'string', nullable: true },
            is_available: { type: 'integer', enum: [0, 1] },
            is_featured: { type: 'integer', enum: [0, 1] },
            is_vegetarian: { type: 'integer', enum: [0, 1] },
            is_vegan: { type: 'integer', enum: [0, 1] },
            sort_order: { type: 'integer' },
          },
        },
        ProductList: {
          type: 'object',
          description: 'Paginated list envelope',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
            total: { type: 'integer' },
            page: { type: 'integer' },
            totalPages: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
        Promotion: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string', description: 'JSON string with lang keys' },
            description: { type: 'string', nullable: true },
            discount_percent: { type: 'integer' },
            dish_ids: { type: 'string', description: 'JSON array of product IDs' },
            category_id: { type: 'integer', nullable: true },
            image: { type: 'string', nullable: true },
            start_date: { type: 'string', format: 'date', nullable: true },
            end_date: { type: 'string', format: 'date', nullable: true },
            is_active: { type: 'integer', enum: [0, 1] },
            sort_order: { type: 'integer' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            items: { type: 'string', description: 'JSON array of cart items' },
            total: { type: 'number' },
            currency: { type: 'string', example: 'AZN' },
            fulfillment_type: { type: 'string', enum: ['pickup', 'delivery'], default: 'pickup' },
            delivery_address: { type: 'string', nullable: true, description: 'Required when fulfillment_type is "delivery"' },
            customer_phone: { type: 'string', nullable: true },
            notes: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['new', 'picking', 'ready', 'done', 'cancelled'], description: '"picking" = staff are gathering the items' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        OrderList: {
          type: 'object',
          description: 'Paginated list envelope',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
            total: { type: 'integer' },
            page: { type: 'integer' },
            totalPages: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
        OkResponse: {
          type: 'object',
          properties: { ok: { type: 'boolean', example: true } },
        },
      },
    },
    tags: [
      { name: 'Catalog', description: 'Public storefront endpoints' },
      { name: 'Orders', description: 'Place orders (public)' },
      { name: 'AI', description: 'AI shopping assistant & recommendations' },
      { name: 'Settings', description: 'Store settings' },
      { name: 'Admin – Categories', description: 'Category management (requires auth)' },
      { name: 'Admin – Products', description: 'Product management (requires auth)' },
      { name: 'Admin – Promotions', description: 'Promotion management (requires auth)' },
      { name: 'Admin – Orders', description: 'Order management (requires auth)' },
    ],
    paths: {
      // ── Catalog (public) ───────────────────────────────────────────
      '/api/menu/categories': {
        get: {
          tags: ['Catalog'],
          summary: 'Get active categories',
          responses: {
            200: {
              description: 'List of active categories',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Category' } } } },
            },
          },
        },
      },
      '/api/menu/dishes': {
        get: {
          tags: ['Catalog'],
          summary: 'Get available products (paginated)',
          parameters: [
            { name: 'category_id', in: 'query', schema: { type: 'integer' }, description: 'Filter by category' },
            { name: 'featured', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'Only featured products' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search in name/description' },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 12, maximum: 50 } },
          ],
          responses: {
            200: { description: 'Paginated products', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductList' } } } },
          },
        },
      },
      '/api/menu/dishes/{id}': {
        get: {
          tags: ['Catalog'],
          summary: 'Get product by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'Product object', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } },
            404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/menu/promotions': {
        get: {
          tags: ['Catalog'],
          summary: 'Get active promotions',
          responses: {
            200: {
              description: 'List of active promotions',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Promotion' } } } },
            },
          },
        },
      },

      // ── Orders (public) ────────────────────────────────────────────
      '/api/orders': {
        post: {
          tags: ['Orders'],
          summary: 'Place a new order',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items', 'total'],
                  properties: {
                    items: { type: 'array', items: { type: 'object' }, description: 'Cart items array (must be non-empty)' },
                    total: { type: 'number' },
                    currency: { type: 'string', example: 'AZN' },
                    fulfillment_type: { type: 'string', enum: ['pickup', 'delivery'], default: 'pickup' },
                    delivery_address: { type: 'string', nullable: true, description: 'Required when fulfillment_type is "delivery"' },
                    customer_phone: { type: 'string', nullable: true },
                    notes: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Created order ID', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } },
            400: { description: 'No items, or delivery selected without an address', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },

      // ── AI ─────────────────────────────────────────────────────────
      '/api/ai/chat': {
        post: {
          tags: ['AI'],
          summary: 'Chat with the shopping assistant',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    message: { type: 'string' },
                    language: { type: 'string', default: 'az', example: 'az' },
                    history: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          role: { type: 'string', enum: ['user', 'assistant'] },
                          content: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'AI reply plus any mentioned products',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      reply: { type: 'string' },
                      dishes: { type: 'array', items: { $ref: '#/components/schemas/Product' }, description: 'Products mentioned in the reply (omitted when offline)' },
                      offline: { type: 'boolean', description: 'True when the AI service is unavailable' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/ai/recommend': {
        post: {
          tags: ['AI'],
          summary: 'Recommend up to 3 products not already in the cart',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    cartItems: { type: 'array', items: { type: 'object' }, description: 'Current cart items (their `id`s are excluded)' },
                    language: { type: 'string', default: 'az' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Recommended products (up to 3)', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } } },
          },
        },
      },

      // ── Settings ───────────────────────────────────────────────────
      '/api/settings/public': {
        get: {
          tags: ['Settings'],
          summary: 'Get public store settings',
          description: 'All settings except private keys (admin_password)',
          responses: {
            200: { description: 'Key-value settings object', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/settings': {
        get: {
          tags: ['Settings'],
          summary: 'Get all settings (admin)',
          security: [{ AdminPassword: [] }],
          responses: {
            200: { description: 'All settings as key-value object', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { description: 'Unauthorized' },
          },
        },
        put: {
          tags: ['Settings'],
          summary: 'Update settings (admin)',
          security: [{ AdminPassword: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', description: 'Key-value pairs to update (the reserved `password` key is ignored)' } } },
          },
          responses: {
            200: { description: 'Updated settings object', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/api/settings/qrcode': {
        post: {
          tags: ['Settings'],
          summary: 'Generate the storefront QR code (admin)',
          security: [{ AdminPassword: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', description: 'Override the menu_url setting' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'QR code as data URL',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      qr: { type: 'string', description: 'Base64 data URL (image/png)' },
                      url: { type: 'string', description: 'The encoded target URL' },
                    },
                  },
                },
              },
            },
            400: { description: 'No menu_url configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ── Admin – Categories ─────────────────────────────────────────
      '/api/admin/categories': {
        get: {
          tags: ['Admin – Categories'],
          summary: 'List all categories',
          security: [{ AdminPassword: [] }],
          responses: {
            200: { description: 'All categories', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Category' } } } } },
          },
        },
        post: {
          tags: ['Admin – Categories'],
          summary: 'Create category (supports icon upload)',
          security: [{ AdminPassword: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string', description: 'JSON lang object' },
                    icon: { type: 'string', example: '🥬' },
                    icon_type: { type: 'string', enum: ['svg', 'emoji', 'image'] },
                    icon_key: { type: 'string', example: 'vegetables' },
                    icon_url: { type: 'string', description: 'Existing icon URL (alternative to iconFile upload)' },
                    sort_order: { type: 'integer', default: 0 },
                    iconFile: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Created ID', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } },
          },
        },
      },
      '/api/admin/categories/{id}': {
        put: {
          tags: ['Admin – Categories'],
          summary: 'Update category (supports icon upload)',
          security: [{ AdminPassword: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', properties: { iconFile: { type: 'string', format: 'binary' } } } } },
          },
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } } },
        },
        delete: {
          tags: ['Admin – Categories'],
          summary: 'Delete category',
          security: [{ AdminPassword: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } } },
        },
      },

      // ── Admin – Products ───────────────────────────────────────────
      '/api/admin/dishes': {
        get: {
          tags: ['Admin – Products'],
          summary: 'List all products (paginated)',
          security: [{ AdminPassword: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            200: { description: 'Paginated products', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductList' } } } },
          },
        },
        post: {
          tags: ['Admin – Products'],
          summary: 'Create product (supports image upload)',
          security: [{ AdminPassword: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['category_id', 'name', 'price'],
                  properties: {
                    category_id: { type: 'integer' },
                    name: { type: 'string', description: 'JSON lang object' },
                    description: { type: 'string' },
                    ingredients: { type: 'string' },
                    price: { type: 'number', description: 'Price per `unit`' },
                    old_price: { type: 'number' },
                    unit: { type: 'string', enum: ['kg', 'piece', 'pack', 'bunch'], default: 'piece' },
                    stock_qty: { type: 'number', description: 'Empty = not tracked; 0 = out of stock' },
                    sku: { type: 'string' },
                    weight: { type: 'integer', description: 'Grams' },
                    calories: { type: 'integer', description: 'Per 100 g' },
                    protein: { type: 'number' },
                    fat: { type: 'number' },
                    carbs: { type: 'number' },
                    allergens: { type: 'string', description: 'JSON array string' },
                    sizes: { type: 'string', description: 'JSON array of {label, price} pack variants (optional)' },
                    is_available: { type: 'integer', enum: [0, 1] },
                    is_featured: { type: 'integer', enum: [0, 1] },
                    is_vegetarian: { type: 'integer', enum: [0, 1] },
                    is_vegan: { type: 'integer', enum: [0, 1] },
                    sort_order: { type: 'integer' },
                    image: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Created ID', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } },
          },
        },
      },
      '/api/admin/dishes/{id}': {
        put: {
          tags: ['Admin – Products'],
          summary: 'Update product (supports image upload)',
          security: [{ AdminPassword: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } } } },
          },
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } } },
        },
        delete: {
          tags: ['Admin – Products'],
          summary: 'Delete product',
          security: [{ AdminPassword: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } } },
        },
      },

      // ── Admin – Promotions ─────────────────────────────────────────
      '/api/admin/promotions': {
        get: {
          tags: ['Admin – Promotions'],
          summary: 'List all promotions',
          security: [{ AdminPassword: [] }],
          responses: {
            200: { description: 'All promotions', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Promotion' } } } } },
          },
        },
        post: {
          tags: ['Admin – Promotions'],
          summary: 'Create promotion (supports image upload)',
          security: [{ AdminPassword: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string', description: 'JSON lang object' },
                    description: { type: 'string' },
                    discount_percent: { type: 'integer' },
                    dish_ids: { type: 'string', description: 'JSON array of product IDs' },
                    category_id: { type: 'integer' },
                    start_date: { type: 'string', format: 'date' },
                    end_date: { type: 'string', format: 'date' },
                    is_active: { type: 'integer', enum: [0, 1] },
                    sort_order: { type: 'integer' },
                    image: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Created ID', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } } },
        },
      },
      '/api/admin/promotions/{id}': {
        put: {
          tags: ['Admin – Promotions'],
          summary: 'Update promotion (supports image upload)',
          security: [{ AdminPassword: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } } } },
          },
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } } },
        },
        delete: {
          tags: ['Admin – Promotions'],
          summary: 'Delete promotion',
          security: [{ AdminPassword: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } } },
        },
      },

      // ── Admin – Orders ─────────────────────────────────────────────
      '/api/admin/orders': {
        get: {
          tags: ['Admin – Orders'],
          summary: 'List orders (paginated, filterable)',
          security: [{ AdminPassword: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['new', 'picking', 'ready', 'done', 'cancelled'] }, description: 'Filter by status' },
            { name: 'date', in: 'query', schema: { type: 'string', enum: ['today', 'yesterday', 'month'] }, description: 'Filter by date range' },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            200: { description: 'Paginated orders', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderList' } } } },
          },
        },
      },
      '/api/admin/orders/stats': {
        get: {
          tags: ['Admin – Orders'],
          summary: 'Order stats for a date range',
          security: [{ AdminPassword: [] }],
          parameters: [
            { name: 'date', in: 'query', schema: { type: 'string', enum: ['today', 'yesterday', 'month'], default: 'today' } },
          ],
          responses: {
            200: {
              description: 'Aggregated stats',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      date: { type: 'string' },
                      count: { type: 'integer' },
                      revenue: { type: 'number', description: 'Sum of done orders' },
                      expectedRevenue: { type: 'number', description: 'Sum of orders not done/cancelled' },
                      newCount: { type: 'integer' },
                      pickingCount: { type: 'integer' },
                      deliveredCount: { type: 'integer' },
                      currency: { type: 'string', example: 'AZN' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/admin/orders/{id}/status': {
        put: {
          tags: ['Admin – Orders'],
          summary: 'Update order status',
          security: [{ AdminPassword: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: { status: { type: 'string', enum: ['new', 'picking', 'ready', 'done', 'cancelled'] } },
                },
              },
            },
          },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
            400: { description: 'Unknown status', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
    },
  },
  apis: [],
};

module.exports = swaggerJsdoc(options);
