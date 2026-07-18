const Database = require('better-sqlite3');
const path = require('path');

let db;

// Unit of sale. Drives how the price is rendered ("2.20 ₼/kq" vs "2.40 ₼")
// and what a quantity step means in the cart.
const UNITS = ['kg', 'piece', 'pack', 'bunch'];

function getDB() {
  if (!db) {
    db = new Database(process.env.DB_PATH || path.join(__dirname, 'market.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDB() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🛒',
      icon_type TEXT DEFAULT 'svg',
      icon_key TEXT,
      icon_url TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS dishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id),
      name TEXT NOT NULL,
      description TEXT,
      ingredients TEXT,
      price REAL NOT NULL,
      old_price REAL,
      unit TEXT DEFAULT 'piece',
      stock_qty REAL,
      sku TEXT,
      weight INTEGER,
      calories INTEGER,
      protein REAL,
      fat REAL,
      carbs REAL,
      allergens TEXT DEFAULT '[]',
      sizes TEXT DEFAULT '[]',
      image TEXT,
      is_available INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      spice_level INTEGER DEFAULT 0,
      is_vegetarian INTEGER DEFAULT 0,
      is_vegan INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      discount_percent INTEGER DEFAULT 0,
      dish_ids TEXT DEFAULT '[]',
      category_id INTEGER,
      image TEXT,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      items TEXT NOT NULL,
      total REAL,
      currency TEXT DEFAULT 'AZN',
      fulfillment_type TEXT DEFAULT 'pickup',
      delivery_address TEXT,
      customer_phone TEXT,
      notes TEXT,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations for databases created by an earlier build of this app.
  const dishCols = db.prepare('PRAGMA table_info(dishes)').all().map(c => c.name);
  if (!dishCols.includes('unit')) db.exec("ALTER TABLE dishes ADD COLUMN unit TEXT DEFAULT 'piece'");
  if (!dishCols.includes('stock_qty')) db.exec('ALTER TABLE dishes ADD COLUMN stock_qty REAL');
  if (!dishCols.includes('sku')) db.exec('ALTER TABLE dishes ADD COLUMN sku TEXT');

  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!orderCols.includes('fulfillment_type')) db.exec("ALTER TABLE orders ADD COLUMN fulfillment_type TEXT DEFAULT 'pickup'");
  if (!orderCols.includes('delivery_address')) db.exec('ALTER TABLE orders ADD COLUMN delivery_address TEXT');

  // Seed demo content only on an empty DB. Unlike the café this was forked from,
  // seeded products carry no photos (image stays NULL and the storefront falls
  // back to the category icon), so there is no broken-image hazard and no reason
  // to gate seeding on Cloudinary being configured.
  const count = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (count.c === 0) seedData(db);

  const defaults = {
    restaurant_name: JSON.stringify({ en: 'GardenMarket', ru: 'GardenMarket', az: 'GardenMarket', tr: 'GardenMarket' }),
    whatsapp_number: '+994519923208',
    phone: '+994519923208',
    instagram: '@gardenmarket.az',
    opening_hours: JSON.stringify({ monday: '09:00–21:00', tuesday: '09:00–21:00', wednesday: '09:00–21:00', thursday: '09:00–21:00', friday: '09:00–21:00', saturday: '09:00–21:00', sunday: '10:00–20:00' }),
    menu_url: 'https://menyuqr.com',
    admin_password: 'admin123',
    primary_language: 'az',
    currency_rates: JSON.stringify({ AZN: 1, USD: 0.588, EUR: 0.541, GBP: 0.461, AED: 2.16, TRY: 20.1, RUB: 54.2 }),
    accent_color: '#4C9A2A',
    show_currency_selector: '1',
    show_language_selector: '1',
    address: 'Bakı, Azərbaycan',
    delivery_fee: '3',
    free_delivery_over: '50',
    logo_image: '',
    hero_image: '',
  };

  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

function seedData(db) {
  const t = (obj) => JSON.stringify(obj);

  const cats = [
    { name: t({ en: 'Vegetables', ru: 'Овощи', az: 'Tərəvəz', tr: 'Sebzeler' }), icon: '🥬', icon_key: 'vegetables', sort_order: 1 },
    { name: t({ en: 'Fruit', ru: 'Фрукты', az: 'Meyvə', tr: 'Meyveler' }), icon: '🍎', icon_key: 'fruit', sort_order: 2 },
    { name: t({ en: 'Meat & Poultry', ru: 'Мясо и птица', az: 'Ət və Toyuq', tr: 'Et ve Tavuk' }), icon: '🍗', icon_key: 'meat', sort_order: 3 },
    { name: t({ en: 'Dairy & Eggs', ru: 'Молочное и яйца', az: 'Süd və Yumurta', tr: 'Süt ve Yumurta' }), icon: '🥛', icon_key: 'dairy', sort_order: 4 },
    { name: t({ en: 'Greens & Herbs', ru: 'Зелень', az: 'Göyərti', tr: 'Yeşillikler' }), icon: '🌿', icon_key: 'herbs', sort_order: 5 },
    { name: t({ en: 'Bakery', ru: 'Выпечка', az: 'Çörək', tr: 'Fırın' }), icon: '🥖', icon_key: 'bakery', sort_order: 6 },
    { name: t({ en: 'Pantry', ru: 'Бакалея', az: 'Quru Ərzaq', tr: 'Kuru Gıda' }), icon: '🌾', icon_key: 'pantry', sort_order: 7 },
  ];

  const insCat = db.prepare("INSERT INTO categories (name, icon, icon_type, icon_key, sort_order) VALUES (?, ?, 'svg', ?, ?)");
  const ids = cats.map(c => insCat.run(c.name, c.icon, c.icon_key, c.sort_order).lastInsertRowid);
  const [vegId, fruitId, meatId, dairyId, herbId, bakeryId, pantryId] = ids;

  // Nutrition figures are per 100 g. `weight` is the typical unit weight in
  // grams; for kg-priced items it is the 1000 g reference.
  const products = [
    // Vegetables
    { category_id: vegId, name: t({ en: 'Eggplant', ru: 'Баклажан', az: 'Badımcan', tr: 'Patlıcan' }), description: t({ en: 'Firm, glossy local eggplant.', ru: 'Плотный глянцевый местный баклажан.', az: 'Bərk, parlaq yerli badımcan.', tr: 'Sıkı, parlak yerli patlıcan.' }), price: 2.2, unit: 'kg', stock_qty: 60, sku: 'VEG-EGG', weight: 1000, calories: 25, protein: 1, fat: 0.2, carbs: 6, is_vegetarian: 1, is_vegan: 1, is_featured: 1, sort_order: 1 },
    { category_id: vegId, name: t({ en: 'Tomato', ru: 'Помидор', az: 'Pomidor', tr: 'Domates' }), description: t({ en: 'Vine-ripened tomatoes.', ru: 'Помидоры, созревшие на ветке.', az: 'Kolda yetişmiş pomidor.', tr: 'Dalında olgunlaşmış domates.' }), price: 2.5, unit: 'kg', stock_qty: 80, sku: 'VEG-TOM', weight: 1000, calories: 18, protein: 0.9, fat: 0.2, carbs: 3.9, is_vegetarian: 1, is_vegan: 1, is_featured: 1, sort_order: 2 },
    { category_id: vegId, name: t({ en: 'Cucumber', ru: 'Огурец', az: 'Xiyar', tr: 'Salatalık' }), description: t({ en: 'Crisp short cucumbers.', ru: 'Хрустящие короткие огурцы.', az: 'Xırtıldayan qısa xiyar.', tr: 'Çıtır kısa salatalık.' }), price: 1.8, unit: 'kg', stock_qty: 70, sku: 'VEG-CUC', weight: 1000, calories: 15, protein: 0.7, fat: 0.1, carbs: 3.6, is_vegetarian: 1, is_vegan: 1, sort_order: 3 },
    { category_id: vegId, name: t({ en: 'Potato', ru: 'Картофель', az: 'Kartof', tr: 'Patates' }), description: t({ en: 'All-purpose potatoes.', ru: 'Универсальный картофель.', az: 'Çoxməqsədli kartof.', tr: 'Çok amaçlı patates.' }), price: 1.2, unit: 'kg', stock_qty: 150, sku: 'VEG-POT', weight: 1000, calories: 77, protein: 2, fat: 0.1, carbs: 17, is_vegetarian: 1, is_vegan: 1, sort_order: 4 },
    { category_id: vegId, name: t({ en: 'Onion', ru: 'Лук', az: 'Soğan', tr: 'Soğan' }), description: t({ en: 'Yellow cooking onions.', ru: 'Жёлтый лук для готовки.', az: 'Bişirmək üçün sarı soğan.', tr: 'Yemeklik sarı soğan.' }), price: 0.9, unit: 'kg', stock_qty: 120, sku: 'VEG-ONI', weight: 1000, calories: 40, protein: 1.1, fat: 0.1, carbs: 9.3, is_vegetarian: 1, is_vegan: 1, sort_order: 5 },
    { category_id: vegId, name: t({ en: 'Bell Pepper', ru: 'Болгарский перец', az: 'Bolqar Bibəri', tr: 'Dolmalık Biber' }), description: t({ en: 'Sweet mixed-colour peppers.', ru: 'Сладкий перец разных цветов.', az: 'Müxtəlif rəngli şirin bibər.', tr: 'Renkli tatlı biber.' }), price: 3, unit: 'kg', stock_qty: 40, sku: 'VEG-PEP', weight: 1000, calories: 31, protein: 1, fat: 0.3, carbs: 6, is_vegetarian: 1, is_vegan: 1, sort_order: 6 },

    // Fruit
    { category_id: fruitId, name: t({ en: 'Apple', ru: 'Яблоко', az: 'Alma', tr: 'Elma' }), description: t({ en: 'Sweet-tart local apples.', ru: 'Кисло-сладкие местные яблоки.', az: 'Şirin-turş yerli alma.', tr: 'Mayhoş yerli elma.' }), price: 2, unit: 'kg', stock_qty: 90, sku: 'FRU-APP', weight: 1000, calories: 52, protein: 0.3, fat: 0.2, carbs: 14, is_vegetarian: 1, is_vegan: 1, sort_order: 1 },
    { category_id: fruitId, name: t({ en: 'Grapes', ru: 'Виноград', az: 'Üzüm', tr: 'Üzüm' }), description: t({ en: 'Seedless white grapes.', ru: 'Белый виноград без косточек.', az: 'Çəyirdəksiz ağ üzüm.', tr: 'Çekirdeksiz beyaz üzüm.' }), price: 3.5, unit: 'kg', stock_qty: 35, sku: 'FRU-GRA', weight: 1000, calories: 69, protein: 0.7, fat: 0.2, carbs: 18, is_vegetarian: 1, is_vegan: 1, sort_order: 2 },
    { category_id: fruitId, name: t({ en: 'Pomegranate', ru: 'Гранат', az: 'Nar', tr: 'Nar' }), description: t({ en: 'Deep-red Goychay pomegranates.', ru: 'Тёмно-красный гёйчайский гранат.', az: 'Tünd qırmızı Göyçay narı.', tr: 'Koyu kırmızı Göyçay narı.' }), price: 3, unit: 'kg', stock_qty: 50, sku: 'FRU-POM', weight: 1000, calories: 83, protein: 1.7, fat: 1.2, carbs: 19, is_vegetarian: 1, is_vegan: 1, is_featured: 1, sort_order: 3 },
    { category_id: fruitId, name: t({ en: 'Lemon', ru: 'Лимон', az: 'Limon', tr: 'Limon' }), description: t({ en: 'Thin-skinned juicy lemons.', ru: 'Сочные лимоны с тонкой кожурой.', az: 'Nazik qabıqlı şirəli limon.', tr: 'İnce kabuklu sulu limon.' }), price: 4, unit: 'kg', stock_qty: 25, sku: 'FRU-LEM', weight: 1000, calories: 29, protein: 1.1, fat: 0.3, carbs: 9, is_vegetarian: 1, is_vegan: 1, sort_order: 4 },

    // Meat & Poultry
    { category_id: meatId, name: t({ en: 'Chicken Thigh', ru: 'Куриное бедро', az: 'Toyuq Budu', tr: 'Tavuk But' }), description: t({ en: 'Fresh bone-in chicken thighs.', ru: 'Свежее куриное бедро на кости.', az: 'Sümüklü təzə toyuq budu.', tr: 'Kemikli taze tavuk but.' }), price: 6.5, unit: 'kg', stock_qty: 30, sku: 'MEA-CTH', weight: 1000, calories: 209, protein: 26, fat: 11, carbs: 0, is_featured: 1, sort_order: 1 },
    { category_id: meatId, name: t({ en: 'Chicken Breast', ru: 'Куриная грудка', az: 'Toyuq Döşü', tr: 'Tavuk Göğsü' }), description: t({ en: 'Skinless boneless fillet.', ru: 'Филе без кожи и костей.', az: 'Dərisiz, sümüksüz filet.', tr: 'Derisiz kemiksiz fileto.' }), price: 8.9, unit: 'kg', stock_qty: 25, sku: 'MEA-CBR', weight: 1000, calories: 165, protein: 31, fat: 3.6, carbs: 0, sort_order: 2 },
    { category_id: meatId, name: t({ en: 'Whole Chicken', ru: 'Целая курица', az: 'Bütöv Toyuq', tr: 'Bütün Tavuk' }), description: t({ en: 'Farm chicken, about 1.5 kg.', ru: 'Фермерская курица, около 1,5 кг.', az: 'Ferma toyuğu, təxminən 1.5 kq.', tr: 'Çiftlik tavuğu, yaklaşık 1.5 kg.' }), price: 9.5, unit: 'piece', stock_qty: 18, sku: 'MEA-CWH', weight: 1500, calories: 190, protein: 27, fat: 8.5, carbs: 0, sort_order: 3 },
    { category_id: meatId, name: t({ en: 'Beef', ru: 'Говядина', az: 'Mal Əti', tr: 'Dana Eti' }), description: t({ en: 'Lean cut, ideal for stews.', ru: 'Постный отруб, идеален для тушения.', az: 'Yağsız kəsim, bozartma üçün ideal.', tr: 'Yağsız parça, yahni için ideal.' }), price: 18, unit: 'kg', stock_qty: 12, sku: 'MEA-BEE', weight: 1000, calories: 250, protein: 26, fat: 15, carbs: 0, sort_order: 4 },

    // Dairy & Eggs
    { category_id: dairyId, name: t({ en: 'Milk 1L', ru: 'Молоко 1л', az: 'Süd 1L', tr: 'Süt 1L' }), description: t({ en: 'Pasteurised whole milk, 3.2%.', ru: 'Пастеризованное молоко 3,2%.', az: 'Pasterizə edilmiş tam yağlı süd, 3.2%.', tr: 'Pastörize tam yağlı süt, %3.2.' }), ingredients: t({ en: ['Whole milk'], ru: ['Цельное молоко'], az: ['Tam yağlı süd'], tr: ['Tam yağlı süt'] }), price: 2.4, unit: 'piece', stock_qty: 45, sku: 'DAI-MLK', weight: 1000, calories: 61, protein: 3.2, fat: 3.2, carbs: 4.8, allergens: '["Dairy"]', is_vegetarian: 1, sort_order: 1 },
    { category_id: dairyId, name: t({ en: 'Eggs (10 pcs)', ru: 'Яйца (10 шт)', az: 'Yumurta (10 əd)', tr: 'Yumurta (10 adet)' }), description: t({ en: 'Free-range eggs, size M.', ru: 'Яйца свободного выгула, размер M.', az: 'Sərbəst gəzən toyuq yumurtası, M ölçü.', tr: 'Gezen tavuk yumurtası, M boy.' }), price: 3.2, unit: 'pack', stock_qty: 40, sku: 'DAI-EGG', weight: 600, calories: 143, protein: 13, fat: 9.5, carbs: 0.7, allergens: '["Eggs"]', is_vegetarian: 1, is_featured: 1, sort_order: 2 },
    { category_id: dairyId, name: t({ en: 'White Cheese', ru: 'Белый сыр', az: 'Ağ Pendir', tr: 'Beyaz Peynir' }), description: t({ en: 'Brined sheep-milk cheese.', ru: 'Рассольный сыр из овечьего молока.', az: 'Duzlu suda saxlanan qoyun pendiri.', tr: 'Salamura koyun peyniri.' }), ingredients: t({ en: ['Sheep milk', 'Salt', 'Culture'], ru: ['Овечье молоко', 'Соль', 'Закваска'], az: ['Qoyun südü', 'Duz', 'Maya'], tr: ['Koyun sütü', 'Tuz', 'Maya'] }), price: 12, unit: 'kg', stock_qty: 15, sku: 'DAI-CHE', weight: 1000, calories: 264, protein: 14, fat: 21, carbs: 4, allergens: '["Dairy"]', is_vegetarian: 1, sort_order: 3 },
    { category_id: dairyId, name: t({ en: 'Yogurt', ru: 'Катык', az: 'Qatıq', tr: 'Yoğurt' }), description: t({ en: 'Thick natural yogurt, 500 g.', ru: 'Густой натуральный катык, 500 г.', az: 'Qatı natural qatıq, 500 q.', tr: 'Yoğun doğal yoğurt, 500 g.' }), ingredients: t({ en: ['Milk', 'Live cultures'], ru: ['Молоко', 'Живые культуры'], az: ['Süd', 'Canlı maya'], tr: ['Süt', 'Canlı maya'] }), price: 2.8, unit: 'piece', stock_qty: 30, sku: 'DAI-YOG', weight: 500, calories: 59, protein: 3.5, fat: 3.3, carbs: 4.7, allergens: '["Dairy"]', is_vegetarian: 1, sort_order: 4 },

    // Greens & Herbs
    { category_id: herbId, name: t({ en: 'Cilantro', ru: 'Кинза', az: 'Keşniş', tr: 'Kişniş' }), description: t({ en: 'Fresh bunch, cut this morning.', ru: 'Свежий пучок, срезан утром.', az: 'Təzə dəstə, səhər kəsilib.', tr: 'Taze demet, sabah kesildi.' }), price: 0.5, unit: 'bunch', stock_qty: 50, sku: 'HRB-CIL', weight: 60, calories: 23, protein: 2.1, fat: 0.5, carbs: 3.7, is_vegetarian: 1, is_vegan: 1, sort_order: 1 },
    { category_id: herbId, name: t({ en: 'Basil', ru: 'Базилик', az: 'Reyhan', tr: 'Reyhan' }), description: t({ en: 'Purple basil, fresh bunch.', ru: 'Фиолетовый базилик, свежий пучок.', az: 'Bənövşəyi reyhan, təzə dəstə.', tr: 'Mor reyhan, taze demet.' }), price: 0.5, unit: 'bunch', stock_qty: 45, sku: 'HRB-BAS', weight: 60, calories: 22, protein: 3.2, fat: 0.6, carbs: 2.6, is_vegetarian: 1, is_vegan: 1, sort_order: 2 },
    { category_id: herbId, name: t({ en: 'Dill', ru: 'Укроп', az: 'Şüyüd', tr: 'Dereotu' }), description: t({ en: 'Fragrant dill, fresh bunch.', ru: 'Ароматный укроп, свежий пучок.', az: 'Ətirli şüyüd, təzə dəstə.', tr: 'Kokulu dereotu, taze demet.' }), price: 0.5, unit: 'bunch', stock_qty: 45, sku: 'HRB-DIL', weight: 60, calories: 43, protein: 3.5, fat: 1.1, carbs: 7, is_vegetarian: 1, is_vegan: 1, sort_order: 3 },

    // Bakery
    { category_id: bakeryId, name: t({ en: 'Tandoor Bread', ru: 'Тандырный хлеб', az: 'Təndir Çörəyi', tr: 'Tandır Ekmeği' }), description: t({ en: 'Baked in a clay tandoor each morning.', ru: 'Выпекается в глиняном тандыре каждое утро.', az: 'Hər səhər gil təndirdə bişirilir.', tr: 'Her sabah kil tandırda pişirilir.' }), ingredients: t({ en: ['Flour', 'Water', 'Yeast', 'Salt'], ru: ['Мука', 'Вода', 'Дрожжи', 'Соль'], az: ['Un', 'Su', 'Maya', 'Duz'], tr: ['Un', 'Su', 'Maya', 'Tuz'] }), price: 1, unit: 'piece', stock_qty: 60, sku: 'BAK-TAN', weight: 400, calories: 266, protein: 8, fat: 1.5, carbs: 55, allergens: '["Gluten"]', is_vegetarian: 1, is_vegan: 1, is_featured: 1, sort_order: 1 },
    { category_id: bakeryId, name: t({ en: 'Lavash', ru: 'Лаваш', az: 'Lavaş', tr: 'Lavaş' }), description: t({ en: 'Thin flatbread, pack of 4.', ru: 'Тонкий лаваш, упаковка 4 шт.', az: 'Nazik lavaş, 4 ədədlik paket.', tr: 'İnce lavaş, 4’lü paket.' }), ingredients: t({ en: ['Flour', 'Water', 'Salt'], ru: ['Мука', 'Вода', 'Соль'], az: ['Un', 'Su', 'Duz'], tr: ['Un', 'Su', 'Tuz'] }), price: 1.5, unit: 'pack', stock_qty: 35, sku: 'BAK-LAV', weight: 300, calories: 275, protein: 9, fat: 1.2, carbs: 57, allergens: '["Gluten"]', is_vegetarian: 1, is_vegan: 1, sort_order: 2 },

    // Pantry
    { category_id: pantryId, name: t({ en: 'Rice', ru: 'Рис', az: 'Düyü', tr: 'Pirinç' }), description: t({ en: 'Long-grain rice for plov.', ru: 'Длиннозёрный рис для плова.', az: 'Plov üçün uzundənəli düyü.', tr: 'Pilav için uzun taneli pirinç.' }), price: 4.5, unit: 'pack', stock_qty: 40, sku: 'PAN-RIC', weight: 1000, calories: 130, protein: 2.7, fat: 0.3, carbs: 28, is_vegetarian: 1, is_vegan: 1, sizes: t([{ label: '1 kq', price: 4.5 }, { label: '5 kq', price: 21 }]), sort_order: 1 },
    { category_id: pantryId, name: t({ en: 'Flour', ru: 'Мука', az: 'Un', tr: 'Un' }), description: t({ en: 'Premium wheat flour.', ru: 'Пшеничная мука высшего сорта.', az: 'Ali növ buğda unu.', tr: 'Birinci sınıf buğday unu.' }), price: 1.6, unit: 'pack', stock_qty: 50, sku: 'PAN-FLR', weight: 1000, calories: 364, protein: 10, fat: 1, carbs: 76, allergens: '["Gluten"]', is_vegetarian: 1, is_vegan: 1, sizes: t([{ label: '1 kq', price: 1.6 }, { label: '5 kq', price: 7.5 }]), sort_order: 2 },
    { category_id: pantryId, name: t({ en: 'Sugar', ru: 'Сахар', az: 'Şəkər', tr: 'Şeker' }), description: t({ en: 'White granulated sugar.', ru: 'Белый сахарный песок.', az: 'Ağ dənəvər şəkər.', tr: 'Beyaz toz şeker.' }), price: 1.9, unit: 'pack', stock_qty: 55, sku: 'PAN-SUG', weight: 1000, calories: 387, protein: 0, fat: 0, carbs: 100, is_vegetarian: 1, is_vegan: 1, sort_order: 3 },
    { category_id: pantryId, name: t({ en: 'Sunflower Oil 1L', ru: 'Подсолнечное масло 1л', az: 'Günəbaxan Yağı 1L', tr: 'Ayçiçek Yağı 1L' }), description: t({ en: 'Refined sunflower oil.', ru: 'Рафинированное подсолнечное масло.', az: 'Təmizlənmiş günəbaxan yağı.', tr: 'Rafine ayçiçek yağı.' }), price: 4.2, unit: 'piece', stock_qty: 30, sku: 'PAN-OIL', weight: 1000, calories: 884, protein: 0, fat: 100, carbs: 0, is_vegetarian: 1, is_vegan: 1, sort_order: 4 },
  ];

  const insProduct = db.prepare(`INSERT INTO dishes (category_id, name, description, ingredients, price, old_price, unit, stock_qty, sku, weight, calories, protein, fat, carbs, allergens, sizes, is_featured, is_vegetarian, is_vegan, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of products) {
    insProduct.run(p.category_id, p.name, p.description || null, p.ingredients || null, p.price, p.old_price || null, UNITS.includes(p.unit) ? p.unit : 'piece', p.stock_qty ?? null, p.sku || null, p.weight || null, p.calories || null, p.protein || null, p.fat || null, p.carbs || null, p.allergens || '[]', p.sizes || '[]', p.is_featured || 0, p.is_vegetarian || 0, p.is_vegan || 0, p.sort_order || 0);
  }

  db.prepare(`INSERT INTO promotions (title, description, discount_percent, is_active, sort_order) VALUES (?, ?, ?, ?, ?)`).run(
    JSON.stringify({ en: 'Fresh Every Morning 🥬', ru: 'Свежее каждое утро 🥬', az: 'Hər səhər təzə 🥬', tr: 'Her sabah taze 🥬' }),
    JSON.stringify({ en: '15% off all vegetables today!', ru: 'Сегодня 15% скидка на все овощи!', az: 'Bu gün bütün tərəvəzlərə 15% endirim!', tr: 'Bugün tüm sebzelerde %15 indirim!' }),
    15, 1, 1
  );
}

module.exports = { getDB, initDB, UNITS };
