import { PrismaClient, STOREAPPROVALSTATUS, PRODUCTSTATUS } from '@prisma/client';

interface ProductSpec {
  name: string;
  brand: string;
  description: string;
  price: number;
  quantityOnHand: number;
  categoryName?: string;
}

interface StoreSpec {
  slug: string;
  storeName: string;
  description: string;
  categoryName: string;
  approvalStatus: STOREAPPROVALSTATUS;
  ownerEmail: string;
  phone: string;
  email: string;
  address: {
    currentAddress: string;
    city: string;
    province: string;
    zipCode: string;
    country: string;
  };
  coordinates: {
    latitude: number;
    longitude: number;
  };
  products: ProductSpec[];
}

const WEEKLY_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  openMinutes: 8 * 60, // 08:00
  closeMinutes: 20 * 60, // 20:00
  isClosed: dayOfWeek === 0, // Closed Sunday
}));

const STORES_CATALOG: StoreSpec[] = [
  // ── SELLER 1: Grace Piatos (seller@example.com) ───────────────────────────
  {
    slug: 'baguio-fresh-harvest',
    storeName: 'Baguio Fresh Harvest',
    description:
      'Farm-to-table organic vegetables, sweet strawberries, and high-altitude highland crops.',
    categoryName: 'Food & Beverage',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'seller@example.com',
    phone: '+639171112222',
    email: 'freshharvest@mapanytime.test',
    address: {
      currentAddress: 'Stall 42-45, Vegetable Section, Baguio City Public Market, Magsaysay Ave',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4172, longitude: 120.5961 },
    products: [
      {
        name: 'Benguet Sweet Strawberries (500g)',
        brand: 'La Trinidad Farms',
        description: 'Freshly harvested highland strawberries, plump, juicy, and naturally sweet.',
        price: 220,
        quantityOnHand: 75,
      },
      {
        name: 'Organic Highland Broccoli (1kg)',
        brand: 'Benguet Growers Co-op',
        description: 'Crisp green broccoli crowns cultivated in the cool mountain climate.',
        price: 180,
        quantityOnHand: 90,
      },
      {
        name: 'Mountain Sayote Tops / Shoots (500g)',
        brand: 'La Trinidad Farms',
        description: 'Tender fresh green shoots perfect for sautéing or clear broths.',
        price: 65,
        quantityOnHand: 50,
      },
      {
        name: 'Crisp Baguio Green Beans (1kg)',
        brand: 'Benguet Growers Co-op',
        description: 'Freshly snapped French beans with a sweet crunch.',
        price: 120,
        quantityOnHand: 60,
      },
      {
        name: 'Pure Cordillera Wild Honey (350ml)',
        brand: 'Highland Apiaries',
        description: '100% raw and unfiltered wild forest honey gathered from pine trees.',
        price: 350,
        quantityOnHand: 40,
      },
      {
        name: 'Sagada Arabica Medium Roast Coffee Beans (500g)',
        brand: 'Sagada Roasters',
        description: 'Single-origin highland arabica with notes of dark chocolate and citrus.',
        price: 480,
        quantityOnHand: 45,
      },
      {
        name: 'Highland Romaine Lettuce Fresh (1kg)',
        brand: 'La Trinidad Farms',
        description: 'Hydroponically grown crisp salad greens delivered same-day.',
        price: 150,
        quantityOnHand: 55,
      },
      {
        name: 'Authentic Baguio Strawberry Jam (12oz Glass Jar)',
        brand: 'Mountain Delight',
        description: 'Whole strawberry preserve with real fruit chunks and reduced sugar.',
        price: 160,
        quantityOnHand: 80,
      },
      {
        name: 'Fresh Baguio Carrots (1kg)',
        brand: 'Benguet Growers Co-op',
        description: 'Sweet, vibrant orange mountain carrots freshly harvested.',
        price: 90,
        quantityOnHand: 85,
      },
      {
        name: 'Highland Wombak Cabbage (1 Head / approx 1.5kg)',
        brand: 'La Trinidad Farms',
        description: 'Dense, leafy Napa cabbage perfect for kimchi, stir-fry, or hot pot.',
        price: 110,
        quantityOnHand: 70,
      },
    ],
  },
  {
    slug: 'cordillera-weaves-crafts',
    storeName: 'Cordillera Weaves & Crafts',
    description:
      'Authentic handwoven tribal fabrics, wooden carvings, and indigenous souvenirs from Benguet and Ifugao.',
    categoryName: 'Fashion & Cosmetics',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'seller@example.com',
    phone: '+639171113333',
    email: 'cordilleracrafts@mapanytime.test',
    address: {
      currentAddress: '15 Leonard Wood Road, Near Wright Park',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4168, longitude: 120.6135 },
    products: [
      {
        name: 'Traditional Inabel Woven Blanket (Queen Size)',
        brand: 'Cordillera Heritage',
        description:
          'Handloomed thick cotton blanket featuring traditional geometric diamond patterns.',
        price: 1450,
        quantityOnHand: 25,
      },
      {
        name: 'Ifugao Ikat Woven Table Runner (2m)',
        brand: 'Banaue Weavers',
        description: 'Intricately dyed handloom runner in deep crimson and indigo.',
        price: 680,
        quantityOnHand: 35,
      },
      {
        name: 'Handcrafted Bamboo Insulated Tumbler 500ml',
        brand: 'Highland Craftworks',
        description: 'Double-walled stainless steel interior with natural carved bamboo exterior.',
        price: 520,
        quantityOnHand: 40,
      },
      {
        name: 'Woven Rattan Backpack (Pasiking Style)',
        brand: 'Cordillera Heritage',
        description: 'Durable handmade rattan backpack traditionally used in mountain treks.',
        price: 1890,
        quantityOnHand: 15,
      },
      {
        name: 'Hand-Carved Pine Wood Salad Bowl Set',
        brand: 'Benguet Woodcrafters',
        description: 'Set of 4 smooth wooden bowls made from sustainable fallen pine timber.',
        price: 850,
        quantityOnHand: 30,
      },
      {
        name: 'Pine Needle Woven Coaster Set (6 Pieces)',
        brand: 'Highland Craftworks',
        description: 'Fragrant natural pine needle coasters with spiral stitch binding.',
        price: 280,
        quantityOnHand: 60,
      },
      {
        name: 'Traditional Brass Gong Souvenir (Gansa Mini)',
        brand: 'Kalinga Brass Smiths',
        description: 'Polished solid brass commemorative gong with carved wooden beater.',
        price: 750,
        quantityOnHand: 20,
      },
      {
        name: 'Woven Ethnic Shawl / Scarf',
        brand: 'Cordillera Heritage',
        description: 'Soft woven wrap in highland earth tones.',
        price: 420,
        quantityOnHand: 45,
      },
    ],
  },
  {
    slug: 'pine-view-bakehouse',
    storeName: 'Pine View Bakehouse',
    description:
      'Freshly baked artisanal breads, pastries, ube treats, and Mountain Province tablea chocolate.',
    categoryName: 'Food & Beverage',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'seller@example.com',
    phone: '+639171114444',
    email: 'pineviewbakehouse@mapanytime.test',
    address: {
      currentAddress: '88 Outlook Drive, South Drive',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4095, longitude: 120.6212 },
    products: [
      {
        name: 'Artisan Raisin Bread Loaf',
        brand: 'Pine View',
        description: 'Packed with plump sun-dried raisins and fragrant cinnamon swirls.',
        price: 240,
        quantityOnHand: 35,
      },
      {
        name: 'Ube Halaya Cheese Pandesal (Box of 6)',
        brand: 'Pine View',
        description: 'Warm purple yam filled rolls topped with melting quickmelt cheese.',
        price: 180,
        quantityOnHand: 50,
      },
      {
        name: 'Highland Country Banana Walnut Loaf',
        brand: 'Pine View',
        description: 'Moist banana cake loaded with roasted Benguet walnuts.',
        price: 260,
        quantityOnHand: 30,
      },
      {
        name: 'Lengua de Gato Butter Crisps (Tub of 250g)',
        brand: 'Pine View',
        description: 'Melt-in-your-mouth delicate butter biscuits baked daily.',
        price: 150,
        quantityOnHand: 60,
      },
      {
        name: 'Choco Crinkles Powdered Box (12 Pieces)',
        brand: 'Pine View',
        description: 'Fudge chocolate cookies dusted with thick powdered confectioner sugar.',
        price: 160,
        quantityOnHand: 45,
      },
      {
        name: 'Pure Mountain Tablea Chocolate Discs (250g)',
        brand: 'Cordillera Cacao',
        description: '100% roasted ground cacao discs for rich traditional hot tsokolate.',
        price: 220,
        quantityOnHand: 50,
      },
      {
        name: 'Benguet Carrot Walnut Cake Slice',
        brand: 'Pine View',
        description: 'Spiced carrot cake with thick cream cheese frosting.',
        price: 125,
        quantityOnHand: 40,
      },
      {
        name: 'Sourdough Country Boule (800g)',
        brand: 'Pine View',
        description: 'Naturally leavened with wild mountain sourdough starter.',
        price: 280,
        quantityOnHand: 25,
      },
    ],
  },

  // ── SELLER 2: Jose Electrico (seller.electrical@mapanytime.test) ───────────
  {
    slug: 'electrico-industrial-supply',
    storeName: 'Electrico Industrial Supply',
    description:
      'Industrial-grade electrical components, wiring, circuit breakers, solar equipment, and smart LED fixtures.',
    categoryName: 'Home & Living',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'seller.electrical@mapanytime.test',
    phone: '+639172223333',
    email: 'sales@electrico.test',
    address: {
      currentAddress: '104 Bokawkan Road, Corner Ferguson Road',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4231, longitude: 120.5891 },
    products: [
      {
        name: 'THHN Copper Building Wire 3.5mm² (150m Roll)',
        brand: 'Phelps Dodge',
        description: 'Dual-rated 90°C dry/wet pure copper building electrical wire.',
        price: 4650,
        quantityOnHand: 20,
      },
      {
        name: 'Miniature Circuit Breaker 2-Pole 30A Plug-in',
        brand: 'Schneider Electric',
        description: 'High-breaking capacity residential and commercial overload protection.',
        price: 450,
        quantityOnHand: 60,
      },
      {
        name: 'Philips Master LED Tube 18W Daylight (Pack of 5)',
        brand: 'Philips',
        description: 'Energy-saving T8 LED fluorescent replacement tubes with 50,000hr lifespan.',
        price: 1250,
        quantityOnHand: 35,
      },
      {
        name: 'Monocrystalline Solar Panel 450W Tier 1',
        brand: 'Canadian Solar',
        description: 'High-efficiency half-cell solar module for off-grid and grid-tie systems.',
        price: 6800,
        quantityOnHand: 15,
      },
      {
        name: 'Pure Sine Wave Solar Inverter 3.2kW 24V',
        brand: 'Growatt',
        description: 'Hybrid MPPT solar inverter with built-in battery charger.',
        price: 19500,
        quantityOnHand: 8,
      },
      {
        name: 'Digital True-RMS Clamp Multimeter Auto-Ranging',
        brand: 'Fluke Compatible',
        description: 'Measures AC/DC voltage, current, resistance, and capacitance accurately.',
        price: 2450,
        quantityOnHand: 25,
      },
      {
        name: 'Industrial Heavy Duty Extension Reel 20m 16A',
        brand: 'Electrico Pro',
        description: 'Rubberised waterproof cable reel with 4 grounded outlets and thermal cutoff.',
        price: 1850,
        quantityOnHand: 30,
      },
      {
        name: 'PVC Electrical Conduit Pipe 20mm (Bundle of 10)',
        brand: 'Crown Pipes',
        description: 'Flame-retardant rigid electrical piping for concealed or surface wiring.',
        price: 890,
        quantityOnHand: 40,
      },
      {
        name: 'Smart WiFi Circuit Breaker Switch 63A with Energy Monitoring',
        brand: 'Tuya Smart',
        description: 'App-controlled DIN rail smart breaker with real-time kWh power tracking.',
        price: 1200,
        quantityOnHand: 35,
      },
      {
        name: 'Heavy Duty Industrial Wall Exhaust Fan 12-inch',
        brand: 'KDK',
        description: 'High-velocity ventilation fan for kitchens, workshops, and warehouses.',
        price: 3100,
        quantityOnHand: 18,
      },
    ],
  },
  {
    slug: 'powertools-pro-shop',
    storeName: 'PowerTools Pro Shop',
    description:
      'Professional power tools, rotary hammers, angle grinders, circular saws, and workshop safety gear.',
    categoryName: 'Home & Living',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'seller.electrical@mapanytime.test',
    phone: '+639172224444',
    email: 'powertools@mapanytime.test',
    address: {
      currentAddress: '45 Magsaysay Avenue, Near Baguio Center Mall',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4189, longitude: 120.5982 },
    products: [
      {
        name: 'Cordless Brushless Impact Drill 18V Kit with 2x 4.0Ah Batteries',
        brand: 'Bosch Professional',
        description: 'Heavy duty brushless motor delivering 60Nm torque with hard carry case.',
        price: 8990,
        quantityOnHand: 15,
      },
      {
        name: 'Heavy Duty 4-inch Angle Grinder 850W',
        brand: 'Makita',
        description: 'Durable motor with labyrinth construction to seal against metal dust.',
        price: 3450,
        quantityOnHand: 30,
      },
      {
        name: 'Circular Saw 7-1/4 inch 1400W with Carbide Blade',
        brand: 'DeWalt',
        description: 'High-speed bevel cut saw with electric brake and aluminum shoe.',
        price: 6200,
        quantityOnHand: 12,
      },
      {
        name: 'Rotary Hammer SDS-Plus 800W 3-Mode',
        brand: 'Total Tools',
        description: 'Drilling, hammer drilling, and chiseling modes for solid concrete.',
        price: 4250,
        quantityOnHand: 20,
      },
      {
        name: 'Mechanics Tool Set 120-Piece Chrome Vanadium',
        brand: 'Stanley',
        description:
          'Complete socket wrench, ratchets, hex keys, and bit driver kit in blow-mold case.',
        price: 4950,
        quantityOnHand: 22,
      },
      {
        name: 'Laser Distance Measure Meter 60m with Pythagorean Calc',
        brand: 'Mileseey',
        description: 'Pocket-sized digital laser ruler with backlit LCD and volume calculation.',
        price: 1350,
        quantityOnHand: 40,
      },
      {
        name: 'Auto-Darkening Welding Helmet Solar Powered',
        brand: 'Total Tools',
        description: 'Variable shade DIN 9-13 optical lens for TIG/MIG/MMA welding.',
        price: 1650,
        quantityOnHand: 25,
      },
      {
        name: 'Nitrile Coated Work Gloves Grip (Pack of 12 Pairs)',
        brand: 'SafetyPro',
        description: 'Abrasion resistant breathable seamless knit gloves for general handling.',
        price: 360,
        quantityOnHand: 50,
      },
    ],
  },

  // ── SELLER 3: Ramon Construccion (seller.hardware@mapanytime.test) ─────────
  {
    slug: 'northern-builders-depot',
    storeName: 'Northern Builders Depot',
    description:
      'Comprehensive construction materials, cement, structural steel rebars, waterproofing, paints, and lumber.',
    categoryName: 'Home & Living',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'seller.hardware@mapanytime.test',
    phone: '+639173335555',
    email: 'northernbuilders@mapanytime.test',
    address: {
      currentAddress: 'Km 4, Marcos Highway, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.3985, longitude: 120.5842 },
    products: [
      {
        name: 'Portland Cement Type 1 (40kg Bag)',
        brand: 'Holcim Excel',
        description: 'Premium general purpose structural concrete and masonry cement.',
        price: 245,
        quantityOnHand: 200,
      },
      {
        name: 'Deformed Steel Rebar Grade 40 12mm x 6m',
        brand: 'SteelAsia',
        description:
          'Standard hot-rolled structural reinforcement steel bar for columns and beams.',
        price: 365,
        quantityOnHand: 150,
      },
      {
        name: 'HardieFlex Fiber Cement Board 4.5mm x 4ft x 8ft',
        brand: 'James Hardie',
        description: 'Moisture and termite resistant ceiling and wall partition board.',
        price: 490,
        quantityOnHand: 100,
      },
      {
        name: 'Boysen Permacoat Latex Paint White 16L Pail',
        brand: 'Boysen',
        description: '100% acrylic interior and exterior semi-gloss wall coating.',
        price: 2950,
        quantityOnHand: 30,
      },
      {
        name: 'Davies Sun & Rain Elastomeric Waterproof Paint 16L',
        brand: 'Davies',
        description: 'Flexible waterproofing wall coating for exterior weather protection.',
        price: 3200,
        quantityOnHand: 25,
      },
      {
        name: 'Phenolic Film Faced Plywood 18mm x 4x8 for Formworks',
        brand: 'Northern Timber',
        description: 'High-reusable waterproof black phenolic form board.',
        price: 1350,
        quantityOnHand: 60,
      },
      {
        name: 'Corrugated GI Roofing Sheet 0.40mm x 12ft',
        brand: 'Colorsteel',
        description: 'Zinc-coated pre-painted green corrugated roofing sheet.',
        price: 680,
        quantityOnHand: 80,
      },
      {
        name: 'PPR Hot & Cold Water Pipe PN20 25mm x 4m',
        brand: 'Vesbo',
        description: 'High-pressure antimicrobial plumbing pipe for residential water systems.',
        price: 310,
        quantityOnHand: 90,
      },
      {
        name: 'Stainless Steel Single Bowl Kitchen Sink 304',
        brand: 'Kohler Grade',
        description: 'Undermount heavy gauge brushed satin finish stainless sink with strainer.',
        price: 2850,
        quantityOnHand: 20,
      },
      {
        name: 'Ready-Mix Tile Adhesive Standard (25kg Bag)',
        brand: 'ABC Phil',
        description: 'Polymer-modified cementitious adhesive for ceramic and granite floor tiles.',
        price: 280,
        quantityOnHand: 110,
      },
    ],
  },
  {
    slug: 'city-glass-aluminum',
    storeName: 'City Glass & Aluminum Supply',
    description:
      'Architectural glass, tempered glass doors, aluminum window frames, silicone sealants, and fittings.',
    categoryName: 'Home & Living',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'seller.hardware@mapanytime.test',
    phone: '+639173336666',
    email: 'cityglass@mapanytime.test',
    address: {
      currentAddress: '78 Rimando Road, Trancoville',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4255, longitude: 120.6015 },
    products: [
      {
        name: 'Aluminum Sliding Window Set 120cm x 120cm with 6mm Tinted Glass',
        brand: 'CityGlass Elite',
        description: 'Powder-coated white aluminum frame complete with lock and insect screen.',
        price: 3800,
        quantityOnHand: 15,
      },
      {
        name: 'Silicone Sealant Neutral Cure 300ml Cartridge (Clear)',
        brand: 'Dow Corning',
        description: 'Weatherproof high-elasticity structural glass sealant.',
        price: 210,
        quantityOnHand: 120,
      },
      {
        name: 'Aluminum Tubular Profile 1x2 inch x 6m (Analok Dark Bronze)',
        brand: 'PhilAluminum',
        description: 'Extruded aluminum alloy framing tube for grilles, partitions, and doors.',
        price: 540,
        quantityOnHand: 60,
      },
      {
        name: 'Frameless Glass Door Hydraulic Patch Fitting Kit',
        brand: 'Dorma Compatible',
        description: 'Top and bottom stainless steel pivot hinges for 10-12mm tempered glass.',
        price: 2650,
        quantityOnHand: 20,
      },
      {
        name: 'Heavy Duty Overhead Door Closer Automatic 85kg',
        brand: 'Yale',
        description: 'Adjustable hydraulic closing and latching speed for exterior doors.',
        price: 1450,
        quantityOnHand: 30,
      },
      {
        name: 'Heavy-Duty Aluminum Screen Door 80cm x 210cm',
        brand: 'CityGlass Elite',
        description: 'Sturdy diamond grille mesh screen door with heavy duty latch handle.',
        price: 2950,
        quantityOnHand: 12,
      },
      {
        name: 'Stainless Steel 304 Glass Standoff Clamps (Pack of 4)',
        brand: 'GlassPro',
        description: 'Brushed finish solid stainless wall brackets for glass railings.',
        price: 780,
        quantityOnHand: 40,
      },
      {
        name: 'Tempered Shower Enclosure Glass Panel 90cm x 200cm (8mm)',
        brand: 'CityGlass Elite',
        description: 'Safety tempered clear float glass with polished beveled edges.',
        price: 4500,
        quantityOnHand: 10,
      },
    ],
  },

  // ── SELLER 4: Alex Mercer (dual@example.com - BUYER & SELLER) ─────────────
  {
    slug: 'session-brews-cafe',
    storeName: 'Session Brews & Cafe',
    description:
      'Specialty pour-over beans, barista tools, cold brew packs, and cafe lifestyle accessories.',
    categoryName: 'Food & Beverage',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'dual@example.com',
    phone: '+639189876543',
    email: 'sessionbrews@mapanytime.test',
    address: {
      currentAddress: '3rd Floor Rooftop, 54 Session Road, Upper Session',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4112, longitude: 120.5975 },
    products: [
      {
        name: 'Atok Benguet Typica Single Origin Beans (1kg)',
        brand: 'Session Brews',
        description: 'Notes of jasmine, honeysuckle, and roasted almonds from Atok highlands.',
        price: 920,
        quantityOnHand: 40,
      },
      {
        name: 'Ready-to-Drink Nitro Cold Brew Bottle (330ml Pack of 4)',
        brand: 'Session Brews',
        description: 'Steeped for 20 hours in cold mountain spring water for a silky, smooth body.',
        price: 380,
        quantityOnHand: 50,
      },
      {
        name: 'Specialty V60 Ceramic Pour-Over Dripper Size 02',
        brand: 'Hario Compatible',
        description: 'Classic spiral ribbed design for consistent thermal brewing extraction.',
        price: 650,
        quantityOnHand: 30,
      },
      {
        name: 'Manual Ceramic Conical Burr Coffee Grinder',
        brand: 'Timemore Design',
        description: 'Precision adjustable click grind settings for French Press to Espresso.',
        price: 1150,
        quantityOnHand: 25,
      },
      {
        name: 'Gooseneck Temperature Control Pouring Kettle 800ml',
        brand: 'BrewMaster',
        description: 'Precision flow spout with digital LED base and 1°C temperature setting.',
        price: 2450,
        quantityOnHand: 18,
      },
      {
        name: 'Dark Roast Espresso Blend (500g)',
        brand: 'Session Brews',
        description: '70% Benguet Arabica / 30% Kalinga Robusta for a rich crema and bold punch.',
        price: 420,
        quantityOnHand: 60,
      },
      {
        name: 'Japanese Ceremonial Grade Matcha Powder (100g)',
        brand: 'Kyoto Imports',
        description: 'Stone ground shade-grown first-harvest green tea powder.',
        price: 780,
        quantityOnHand: 35,
      },
      {
        name: 'Artisan Glass Coffee French Press 600ml',
        brand: 'BrewMaster',
        description: 'Borosilicate heatproof glass beaker with double micro-mesh plunger.',
        price: 490,
        quantityOnHand: 40,
      },
      {
        name: 'Unbleached Paper Coffee Filters Size 02 (100 Sheets)',
        brand: 'Session Brews',
        description: 'Oxygen-whitened eco-friendly cone paper filters.',
        price: 140,
        quantityOnHand: 100,
      },
      {
        name: 'Coffee Syrup Set: Vanilla, Caramel, Hazelnut (3x 250ml)',
        brand: 'Monin Grade',
        description: 'All-natural cane sugar bar syrups for iced lattes and specialty beverages.',
        price: 620,
        quantityOnHand: 30,
      },
    ],
  },
  {
    slug: 'urban-pulse-apparel',
    storeName: 'Urban Pulse Apparel',
    description:
      'Highland streetwear, oversized graphic hoodies, corduroy headwear, and weatherproof outerwear.',
    categoryName: 'Fashion & Cosmetics',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'dual@example.com',
    phone: '+639189877777',
    email: 'urbanpulse@mapanytime.test',
    address: {
      currentAddress: 'Unit 12, Session Mall, Governor Pack Road',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4101, longitude: 120.5988 },
    products: [
      {
        name: 'Baguio Fog Heavyweight Fleece Hoodie (Charcoal Gray)',
        brand: 'Urban Pulse',
        description: '450 GSM French terry fleece with double-lined hood and drop shoulders.',
        price: 1650,
        quantityOnHand: 35,
      },
      {
        name: 'Oversized Boxy Graphic Tee (Pine City Edition)',
        brand: 'Urban Pulse',
        description: '240 GSM heavy combed cotton with high-density screen print.',
        price: 680,
        quantityOnHand: 55,
      },
      {
        name: 'Water-Repellent Mountain Windbreaker Anorak',
        brand: 'Urban Pulse Outdoor',
        description: 'Ripstop nylon shell with taped seams, front pouch, and adjustable bungee.',
        price: 1950,
        quantityOnHand: 20,
      },
      {
        name: 'Relaxed Fit Cargo Utility Pants with Detachable Straps',
        brand: 'Urban Pulse',
        description: 'Durable cotton-twill cargo trousers with 6 functional pockets.',
        price: 1450,
        quantityOnHand: 30,
      },
      {
        name: 'Vintage Wash Corduroy 6-Panel Dad Cap',
        brand: 'Urban Pulse',
        description: 'Embroidered mountain logo with antique brass clasp closure.',
        price: 450,
        quantityOnHand: 60,
      },
      {
        name: 'Heavy Duty Canvas Crossbody Shoulder Bag',
        brand: 'Urban Pulse',
        description: 'Multi-compartment tactical sling bag with water-resistant lining.',
        price: 720,
        quantityOnHand: 40,
      },
      {
        name: 'Thermal Knit Beanie (Forest Green)',
        brand: 'Urban Pulse',
        description: 'Ribbed acrylic wool blend skull cap for chilly mountain evenings.',
        price: 320,
        quantityOnHand: 70,
      },
      {
        name: 'Retro UV400 Polarized Sunglasses with Bamboo Arms',
        brand: 'Urban Pulse Eyewear',
        description: 'Matte black frame with natural bamboo wooden temples and microfiber pouch.',
        price: 580,
        quantityOnHand: 45,
      },
    ],
  },

  // ── SELLER 5: System Admin (admin@example.com) ─────────────────────────────
  {
    slug: 'apex-tech-solutions',
    storeName: 'Apex Tech & Gadget Hub',
    description:
      'Flagship mechanical keyboards, ergonomic workstation gear, 4K monitors, and smart lifestyle tech.',
    categoryName: 'Electronics',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'admin@example.com',
    phone: '+639175558888',
    email: 'apextech@mapanytime.test',
    address: {
      currentAddress: '3rd Level Cyberzone, SM City Baguio, Luneta Hill',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4082, longitude: 120.6011 },
    products: [
      {
        name: 'Wireless Mechanical Keyboard 75% Hot-Swappable (Gateron Yellow Switches)',
        brand: 'ApexTech Pro',
        description: 'Tri-mode Bluetooth/2.4G/USB-C connection with sound-dampening gasket mount.',
        price: 3650,
        quantityOnHand: 25,
      },
      {
        name: 'Ergonomic Vertical Wireless Mouse 2.4GHz + Bluetooth',
        brand: 'ApexTech Pro',
        description: '57° ergonomic handshake angle with silent clicks and rechargeable battery.',
        price: 980,
        quantityOnHand: 40,
      },
      {
        name: '4K Ultra-HD Webcam 60FPS with Dual Noise-Canceling Microphones',
        brand: 'LogiStream',
        description: 'Auto-focus Sony sensor with privacy shutter and ring light fill.',
        price: 2890,
        quantityOnHand: 20,
      },
      {
        name: 'Active Noise-Cancelling Over-Ear Bluetooth Headphones',
        brand: 'ApexTech Audio',
        description: 'Hybrid 40dB ANC, 40mm titanium drivers, and 45-hour battery playtime.',
        price: 3450,
        quantityOnHand: 22,
      },
      {
        name: 'Dual Monitor Gas Spring Heavy Duty Desk Mount Arm',
        brand: 'NorthBayou Style',
        description: 'Supports two 17-32 inch screens with full 360° tilt, swivel, and rotation.',
        price: 1850,
        quantityOnHand: 30,
      },
      {
        name: 'Portable External NVMe SSD 1TB USB 3.2 Gen 2 (1050MB/s)',
        brand: 'SanDisk Grade',
        description: 'Shock-resistant aluminum enclosure with USB-C to C and A cables.',
        price: 4950,
        quantityOnHand: 28,
      },
      {
        name: 'USB-C 8-in-1 Multiport Hub with 4K HDMI & 100W Power Delivery',
        brand: 'ApexTech Pro',
        description: 'Includes SD/TF card reader, 3x USB 3.0, Gigabit Ethernet, and HDMI.',
        price: 1350,
        quantityOnHand: 50,
      },
      {
        name: 'Smart LED Monitor ScreenBar Light with Auto-Dimming Sensor',
        brand: 'Baseus Style',
        description: 'Zero screen glare asymmetrical optical design with stepless touch control.',
        price: 1450,
        quantityOnHand: 35,
      },
      {
        name: 'GaN Fast Charger 100W 4-Port USB-C Desktop Charging Station',
        brand: 'Voltix GaN',
        description:
          'Charges laptops, tablets, and phones simultaneously with dynamic power sharing.',
        price: 2150,
        quantityOnHand: 30,
      },
      {
        name: 'Extended Anti-Fray Desk Pad Mat (900x400mm World Map)',
        brand: 'ApexTech Pro',
        description:
          'Smooth micro-weave surface with non-slip natural rubber base and stitched edges.',
        price: 480,
        quantityOnHand: 60,
      },
    ],
  },

  // ── SELLER 6: Maria Artesano (support@mapanytime.test) ─────────────────────
  {
    slug: 'benguet-artisan-crafts',
    storeName: 'Benguet Artisan Crafts',
    description:
      'Eco-friendly sustainable crafts, handmade natural soaps, beeswax candles, and pottery.',
    categoryName: 'Fashion & Cosmetics',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    ownerEmail: 'support@mapanytime.test',
    phone: '+639176669999',
    email: 'artisan@mapanytime.test',
    address: {
      currentAddress: 'Tam-awan Village Craft Center, Pinsao Proper',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4298, longitude: 120.5784 },
    products: [
      {
        name: 'Pure Pine Forest Scented Natural Soy Wax Candle (200g)',
        brand: 'Tam-Awan Aromatics',
        description:
          'Infused with organic Benguet pine needle oil and cedarwood in amber glass jar.',
        price: 420,
        quantityOnHand: 45,
      },
      {
        name: 'Handcrafted Cold-Process Goat Milk & Honey Soap Bar',
        brand: 'Mountain Botanicals',
        description: 'Gentle exfoliating bar with wild honey and colloidal oatmeal.',
        price: 140,
        quantityOnHand: 80,
      },
      {
        name: 'Handmade Terra Cotta Ceramic Succulent Planter',
        brand: 'Tam-Awan Pottery',
        description: 'Hand-thrown clay pot with drainage hole and saucer in rustic finish.',
        price: 280,
        quantityOnHand: 35,
      },
      {
        name: 'Natural Loofah Body Scrub Sponges (Set of 3)',
        brand: 'Mountain Botanicals',
        description: '100% plant-based organic bath sponge harvested in Benguet.',
        price: 180,
        quantityOnHand: 60,
      },
      {
        name: 'Hand-Painted Floral Canvas Tote Bag (Sunflower Edition)',
        brand: 'Tam-Awan Artisans',
        description: 'Heavy duty natural cotton canvas tote with interior zipper pocket.',
        price: 350,
        quantityOnHand: 40,
      },
      {
        name: 'Handmade Bamboo Cutlery Travel Set with Pouch',
        brand: 'EcoBenguet',
        description: 'Includes bamboo spoon, fork, knife, chopsticks, straw, and cleaning brush.',
        price: 220,
        quantityOnHand: 55,
      },
      {
        name: 'Raw Beeswax Food Wrap Assorted Set (3 Sizes: S, M, L)',
        brand: 'EcoBenguet',
        description: 'Reusable organic cotton wraps coated with beeswax and jojoba oil.',
        price: 380,
        quantityOnHand: 40,
      },
      {
        name: 'Highland Essential Oil Roll-On Blend (Calm & Sleep 10ml)',
        brand: 'Tam-Awan Aromatics',
        description:
          'Lavender, pine, and chamomile pure essential oils diluted in sweet almond oil.',
        price: 260,
        quantityOnHand: 50,
      },
    ],
  },
];

export async function seedStoresAndProducts(prisma: PrismaClient) {
  console.log('🌱 Seeding extensive multi-user Stores & Product Catalog...');

  // Map category names to IDs
  const categories = await prisma.categories.findMany();
  const categoryMap = new Map<string, string>();
  for (const cat of categories) {
    categoryMap.set(cat.name.toLowerCase(), cat.id);
  }

  for (const storeSpec of STORES_CATALOG) {
    // 1. Locate seller owner
    const user = await prisma.users.findUnique({
      where: { email: storeSpec.ownerEmail },
    });

    if (!user) {
      console.log(
        `⚠️ User not found for email: ${storeSpec.ownerEmail}. Skipping store: ${storeSpec.storeName}`,
      );
      continue;
    }

    // Ensure seller profile exists
    const seller = await prisma.sellers.upsert({
      where: { userId: user.id },
      update: {
        applicationStatus: 'APPROVED',
        onboardingStep: 4,
      },
      create: {
        userId: user.id,
        applicationStatus: 'APPROVED',
        onboardingStep: 4,
        sellerPlan: 'PRO',
      },
    });

    // Match primary category
    const categoryId = categoryMap.get(storeSpec.categoryName.toLowerCase()) || categories[0]?.id;

    // 2. Upsert Store by slug
    const store = await prisma.stores.upsert({
      where: { slug: storeSpec.slug },
      update: {
        storeName: storeSpec.storeName,
        description: storeSpec.description,
        approvalStatus: storeSpec.approvalStatus,
        isActive: storeSpec.approvalStatus === STOREAPPROVALSTATUS.ACTIVE,
        primaryCategoryId: categoryId,
        phone: storeSpec.phone,
        email: storeSpec.email,
      },
      create: {
        sellerId: seller.id,
        slug: storeSpec.slug,
        storeName: storeSpec.storeName,
        description: storeSpec.description,
        approvalStatus: storeSpec.approvalStatus,
        isActive: storeSpec.approvalStatus === STOREAPPROVALSTATUS.ACTIVE,
        primaryCategoryId: categoryId,
        phone: storeSpec.phone,
        email: storeSpec.email,
      },
    });

    // 3. Upsert StoreLocation
    await prisma.storeLocations.upsert({
      where: { storeId: store.id },
      update: {
        currentAddress: storeSpec.address.currentAddress,
        homeAddress: storeSpec.address.currentAddress,
        city: storeSpec.address.city,
        province: storeSpec.address.province,
        zipCode: storeSpec.address.zipCode,
        country: storeSpec.address.country,
        latitude: storeSpec.coordinates.latitude,
        longitude: storeSpec.coordinates.longitude,
      },
      create: {
        storeId: store.id,
        currentAddress: storeSpec.address.currentAddress,
        homeAddress: storeSpec.address.currentAddress,
        city: storeSpec.address.city,
        province: storeSpec.address.province,
        zipCode: storeSpec.address.zipCode,
        country: storeSpec.address.country,
        latitude: storeSpec.coordinates.latitude,
        longitude: storeSpec.coordinates.longitude,
      },
    });

    // 4. Seed StoreHours (Mon-Sat 8:00-20:00)
    for (const hour of WEEKLY_HOURS) {
      await prisma.storeHours.upsert({
        where: {
          storeId_dayOfWeek: {
            storeId: store.id,
            dayOfWeek: hour.dayOfWeek,
          },
        },
        update: {
          openMinutes: hour.openMinutes,
          closeMinutes: hour.closeMinutes,
          isClosed: hour.isClosed,
        },
        create: {
          storeId: store.id,
          dayOfWeek: hour.dayOfWeek,
          openMinutes: hour.openMinutes,
          closeMinutes: hour.closeMinutes,
          isClosed: hour.isClosed,
        },
      });
    }

    // 5. Seed Products & Inventories for Store
    let productCount = 0;
    for (const prodSpec of storeSpec.products) {
      const prodCatId = prodSpec.categoryName
        ? categoryMap.get(prodSpec.categoryName.toLowerCase()) || categoryId
        : categoryId;

      let product = await prisma.products.findFirst({
        where: {
          storeId: store.id,
          name: prodSpec.name,
        },
      });

      if (!product) {
        product = await prisma.products.create({
          data: {
            storeId: store.id,
            categoryId: prodCatId,
            name: prodSpec.name,
            brand: prodSpec.brand,
            description: prodSpec.description,
            price: prodSpec.price,
            status: PRODUCTSTATUS.APPROVED,
            isActive: true,
            listedAt: new Date(),
          },
        });

        await prisma.inventory.create({
          data: {
            storeId: store.id,
            productId: product.id,
            quantityOnHand: prodSpec.quantityOnHand,
            quantityReserved: 0,
          },
        });
      } else {
        await prisma.products.update({
          where: { id: product.id },
          data: {
            price: prodSpec.price,
            description: prodSpec.description,
            brand: prodSpec.brand,
            status: PRODUCTSTATUS.APPROVED,
            isActive: true,
          },
        });

        const inv = await prisma.inventory.findFirst({
          where: { storeId: store.id, productId: product.id },
        });
        if (inv) {
          await prisma.inventory.update({
            where: { id: inv.id },
            data: { quantityOnHand: prodSpec.quantityOnHand },
          });
        } else {
          await prisma.inventory.create({
            data: {
              storeId: store.id,
              productId: product.id,
              quantityOnHand: prodSpec.quantityOnHand,
              quantityReserved: 0,
            },
          });
        }
      }

      productCount++;
    }

    console.log(
      `✅ Seeded store "${store.storeName}" (${storeSpec.slug}) with ${productCount} products.`,
    );
  }

  console.log('✅ All multi-user stores & product catalogs seeded successfully!');
}
