import pg from 'pg';
import bcrypt from 'bcryptjs';
import { pool, verifyCockroachConnection } from './pool.js';
import { runMigrations } from './migrate.js';

interface CategorySeed {
  name: string;
  slug: string;
  description: string;
  image_url: string;
  display_order: number;
}

interface BranchSeed {
  branch_name: string;
  branch_code: string;
  address: string;
  locality: string;
  latitude: number;
  longitude: number;
  opening_hours: string;
  contact_phone?: string;
  delivery_fee: string;
  min_order_amount: string;
  estimated_delivery_time: string;
  delivery_radius_km: number;
  price_delta: number; // Branch-specific price variation in INR
  covered_localities: string[];
}

export const BRANCH_CONTACT_PHONES: Record<string, string> = {
  'SR-TNAGAR': '+91 44 2434 1101',
  'SR-VELACHERY': '+91 44 2243 1102',
  'SR-ANNANAGAR': '+91 44 2621 1103',
  'TBH-ADYAR': '+91 44 2441 2201',
  'TBH-VELACHERY': '+91 44 2245 2202',
  'TBH-TAMBARAM': '+91 44 2226 2203',
  'UC-NUNGAMBAKKAM': '+91 44 2833 3301',
  'UC-OMR': '+91 44 2454 3302',
  'UC-ANNANAGAR': '+91 44 2626 3303',
  'WR-TNAGAR': '+91 44 2815 4401',
  'WR-ADYAR': '+91 44 2442 4402',
  'WR-PORUR': '+91 44 2476 4403',
  'BD-VELACHERY': '+91 44 2259 5501',
  'BD-OMR': '+91 44 2450 5502',
  'BD-ANNANAGAR': '+91 44 2618 5503',
  'ST-ADYAR': '+91 44 2445 6601',
  'ST-NUNGAMBAKKAM': '+91 44 2827 6602',
  'ST-TAMBARAM': '+91 44 2239 6603',
};

interface MenuItemSeed {
  name: string;
  slug: string;
  category_slug: string;
  description: string;
  image_url: string;
  is_veg: boolean;
  spice_level: string;
  serves_info: string;
  is_bestseller: boolean;
  base_price: string;
}

interface RestaurantSeed {
  name: string;
  slug: string;
  description: string;
  cuisine: string;
  image_url: string;
  banner_url: string;
  rating: string;
  review_count: number;
  price_range: string;
  is_featured: boolean;
  offer_badge: string;
  branches: BranchSeed[];
  menu_items: MenuItemSeed[];
}

export const CATEGORIES_SEED: CategorySeed[] = [
  {
    name: 'South Indian',
    slug: 'south-indian',
    description: 'Crispy dosas, fluffy idlis, filter coffee & coastal curries',
    image_url: 'https://images.unsplash.com/photo-1630383249896-424e482df921?auto=format&fit=crop&w=600&q=80',
    display_order: 1,
  },
  {
    name: 'North Indian',
    slug: 'north-indian',
    description: 'Rich butter masalas, tandoori breads & slow-simmered dals',
    image_url: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=600&q=80',
    display_order: 2,
  },
  {
    name: 'Biryani',
    slug: 'biryani',
    description: 'Aromatic saffron-layered dum biryanis & Mughlai delicacies',
    image_url: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80',
    display_order: 3,
  },
  {
    name: 'Chinese',
    slug: 'chinese',
    description: 'Wok-tossed Hakka noodles, dim sums & fiery Szechuan bowls',
    image_url: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=600&q=80',
    display_order: 4,
  },
  {
    name: 'Pizza',
    slug: 'pizza',
    description: 'Wood-fired artisan sourdough pizzas & Italian pastas',
    image_url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80',
    display_order: 5,
  },
  {
    name: 'Burgers',
    slug: 'burgers',
    description: 'Smashed gourmet burgers, loaded fries & crispy sliders',
    image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80',
    display_order: 6,
  },
  {
    name: 'Starters',
    slug: 'starters',
    description: 'Crispy appetizers, tandoori kebabs, wings & bruschetta',
    image_url: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=600&q=80',
    display_order: 7,
  },
  {
    name: 'Desserts',
    slug: 'desserts',
    description: 'Decadent Belgian waffles, cheesecakes, brownies & gulab jamun',
    image_url: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=600&q=80',
    display_order: 8,
  },
  {
    name: 'Beverages',
    slug: 'beverages',
    description: 'Artisanal cold brews, thick shakes, lassis & mocktails',
    image_url: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=600&q=80',
    display_order: 9,
  },
];

export const RESTAURANTS_SEED: RestaurantSeed[] = [
  // 1. Spice Route
  {
    name: 'Spice Route',
    slug: 'spice-route',
    description:
      'Authentic heritage recipes uniting Tamil Nadu temple-town tiffins with royal North Indian tandoori kitchens. (Fictional demonstration brand)',
    cuisine: 'South Indian and North Indian',
    image_url: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=900&q=80',
    banner_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1400&q=80',
    rating: '4.60',
    review_count: 1420,
    price_range: '₹250 for two',
    is_featured: true,
    offer_badge: 'FLAT ₹75 OFF above ₹399',
    branches: [
      {
        branch_name: 'Spice Route - T. Nagar',
        branch_code: 'SR-TNAGAR',
        address: '42 Usman Road, Near Panagal Park, T. Nagar, Chennai 600017',
        locality: 'T. Nagar',
        latitude: 13.0418,
        longitude: 80.2341,
        opening_hours: '07:00 AM - 11:00 PM',
        delivery_fee: '30.00',
        min_order_amount: '149.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 8.5,
        price_delta: 0,
        covered_localities: ['T. Nagar', 'Nungambakkam', 'Kodambakkam', 'Mylapore', 'Alwarpet', 'Saidapet', 'West Mambalam'],
      },
      {
        branch_name: 'Spice Route - Velachery',
        branch_code: 'SR-VELACHERY',
        address: '118 Velachery Main Road, Vijayanagar, Velachery, Chennai 600042',
        locality: 'Velachery',
        latitude: 12.9756,
        longitude: 80.2207,
        opening_hours: '07:30 AM - 11:00 PM',
        delivery_fee: '35.00',
        min_order_amount: '149.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 9.0,
        price_delta: 10,
        covered_localities: ['Velachery', 'Adyar', 'Guindy', 'Madipakkam', 'Pallikaranai', 'Taramani', 'OMR'],
      },
      {
        branch_name: 'Spice Route - Anna Nagar',
        branch_code: 'SR-ANNANAGAR',
        address: '2nd Avenue, Y Block, Near Anna Nagar Tower Park, Chennai 600040',
        locality: 'Anna Nagar',
        latitude: 13.085,
        longitude: 80.2101,
        opening_hours: '07:00 AM - 11:30 PM',
        delivery_fee: '35.00',
        min_order_amount: '159.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 8.5,
        price_delta: 15,
        covered_localities: ['Anna Nagar', 'Kilpauk', 'Mogappair', 'Koyambedu', 'Aminjikarai', 'Vadapalani'],
      },
    ],
    menu_items: [
      {
        name: 'Ghee Roast Masala Dosa',
        slug: 'sr-ghee-roast-masala-dosa',
        category_slug: 'south-indian',
        description: 'Golden paper-crisp fermented crepe roasted in pure cow ghee, stuffed with spiced potato masala and served with 3 chutneys & sambar.',
        image_url: 'https://images.unsplash.com/photo-1630383249896-424e482df921?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '145.00',
      },
      {
        name: 'Madurai Podi Mini Idli (14 Pcs)',
        slug: 'sr-madurai-podi-mini-idli',
        category_slug: 'south-indian',
        description: 'Steamed button idlis tossed generously in roasted sesame-lentil gun-powder and melted homemade ghee.',
        image_url: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '125.00',
      },
      {
        name: 'Chettinad Pepper Chicken Masala',
        slug: 'sr-chettinad-pepper-chicken',
        category_slug: 'south-indian',
        description: 'Succulent bone-in chicken slow-cooked with freshly ground Karaikudi black pepper, kalpasi, star anise and roasted coconut.',
        image_url: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 2',
        is_bestseller: true,
        base_price: '285.00',
      },
      {
        name: 'Old Delhi Butter Chicken',
        slug: 'sr-old-delhi-butter-chicken',
        category_slug: 'north-indian',
        description: 'Charcoal-grilled chicken tikka simmered in velvety makhani tomato-cashew gravy finished with kasuri methi and cream.',
        image_url: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Mild',
        serves_info: 'Serves 2',
        is_bestseller: true,
        base_price: '295.00',
      },
      {
        name: 'Paneer Tikka Lababdar',
        slug: 'sr-paneer-tikka-lababdar',
        category_slug: 'north-indian',
        description: 'Cubes of malai cottage cheese charred in clay oven and folded into a rich onion-tomato masala with bell peppers.',
        image_url: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 2',
        is_bestseller: false,
        base_price: '260.00',
      },
      {
        name: 'Dal Makhani Bukhara Style',
        slug: 'sr-dal-makhani-bukhara',
        category_slug: 'north-indian',
        description: 'Whole black urad lentils slow-simmered overnight for 18 hours over embers with white butter and ginger juliennes.',
        image_url: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2',
        is_bestseller: false,
        base_price: '220.00',
      },
      {
        name: 'Garlic Butter Naan Basket (2 Pcs)',
        slug: 'sr-garlic-butter-naan-basket',
        category_slug: 'north-indian',
        description: 'Leavened tandoori flatbreads brushed with roasted garlic butter and fresh coriander leaves.',
        image_url: 'https://images.unsplash.com/photo-1626074353765-517a681e40be?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1-2',
        is_bestseller: false,
        base_price: '95.00',
      },
      {
        name: 'Tandoori Malai Broccoli',
        slug: 'sr-tandoori-malai-broccoli',
        category_slug: 'starters',
        description: 'Crisp broccoli florets marinated in hung curd, cardamom, cheddar cheese & white pepper, roasted in the tandoor.',
        image_url: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2',
        is_bestseller: false,
        base_price: '230.00',
      },
      {
        name: 'Kumbakonam Degree Filter Coffee',
        slug: 'sr-kumbakonam-filter-coffee',
        category_slug: 'beverages',
        description: 'Traditional brass-davara brewed chicory-arabica decoction frothed with farm-fresh boiling milk.',
        image_url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (200ml)',
        is_bestseller: true,
        base_price: '75.00',
      },
      {
        name: 'Warm Elaneer Payasam',
        slug: 'sr-elaneer-payasam',
        category_slug: 'desserts',
        description: 'Delicate tender coconut pulp and coconut milk kheer scented with green cardamom and roasted cashews.',
        image_url: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: false,
        base_price: '135.00',
      },
    ],
  },

  // 2. The Biryani House
  {
    name: 'The Biryani House',
    slug: 'the-biryani-house',
    description:
      'Royal copper-handi dum biryanis crafted with aged basmati & seeraga samba rice, saffron strands, and artisanal Mughlai kebabs. (Fictional demonstration brand)',
    cuisine: 'Biryani and Mughlai',
    image_url: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=900&q=80',
    banner_url: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=1400&q=80',
    rating: '4.75',
    review_count: 2390,
    price_range: '₹350 for two',
    is_featured: true,
    offer_badge: 'FREE Gulab Jamun on orders ₹499+',
    branches: [
      {
        branch_name: 'The Biryani House - Adyar',
        branch_code: 'TBH-ADYAR',
        address: '14 Sardar Patel Road, Kasturba Nagar, Adyar, Chennai 600020',
        locality: 'Adyar',
        latitude: 13.0012,
        longitude: 80.2565,
        opening_hours: '11:00 AM - 11:45 PM',
        delivery_fee: '35.00',
        min_order_amount: '199.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 9.0,
        price_delta: 0,
        covered_localities: ['Adyar', 'Besant Nagar', 'Thiruvanmiyur', 'Kotturpuram', 'Guindy', 'Mylapore', 'Velachery'],
      },
      {
        branch_name: 'The Biryani House - Velachery',
        branch_code: 'TBH-VELACHERY',
        address: '89 100 Feet Bypass Road, Velachery, Chennai 600042',
        locality: 'Velachery',
        latitude: 12.9791,
        longitude: 80.2184,
        opening_hours: '11:00 AM - 11:45 PM',
        delivery_fee: '30.00',
        min_order_amount: '179.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 9.0,
        price_delta: 0,
        covered_localities: ['Velachery', 'Guindy', 'Adyar', 'Madipakkam', 'Pallikaranai', 'Nanganallur', 'OMR'],
      },
      {
        branch_name: 'The Biryani House - Tambaram',
        branch_code: 'TBH-TAMBARAM',
        address: '54 GST Road, West Tambaram, Near Tambaram Railway Station, Chennai 600045',
        locality: 'Tambaram',
        latitude: 12.9249,
        longitude: 80.1,
        opening_hours: '11:00 AM - 11:00 PM',
        delivery_fee: '25.00',
        min_order_amount: '149.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 8.5,
        price_delta: -15,
        covered_localities: ['Tambaram', 'Chromepet', 'Pallavaram', 'Selaiyur', 'Perungalathur', 'Vandalur'],
      },
    ],
    menu_items: [
      {
        name: 'Royal Hyderabadi Chicken Dum Biryani',
        slug: 'tbh-hyderabadi-chicken-dum-biryani',
        category_slug: 'biryani',
        description: 'Long-grain aged basmati layered over saffron-marinated chicken, caramelized birista, mint & sealed with dough in a copper handi. Served with mirchi ka salan & raita.',
        image_url: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 1-2 (650g)',
        is_bestseller: true,
        base_price: '299.00',
      },
      {
        name: 'Ambur Seeraga Samba Mutton Biryani',
        slug: 'tbh-ambur-mutton-biryani',
        category_slug: 'biryani',
        description: 'Tender baby goat cuts slow-cooked with aromatic short-grain seeraga samba rice, red chilli paste & curd. Comes with kathirikai brinjal thokku.',
        image_url: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 1-2 (650g)',
        is_bestseller: true,
        base_price: '369.00',
      },
      {
        name: 'Subz Nizami Paneer & Jackfruit Biryani',
        slug: 'tbh-subz-nizami-paneer-biryani',
        category_slug: 'biryani',
        description: 'Chargrilled malai paneer cubes and tender kathal layered with saffron rice, rose water, kewra and roasted nuts.',
        image_url: 'https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 1-2 (600g)',
        is_bestseller: true,
        base_price: '259.00',
      },
      {
        name: 'Mughlai Roast Egg Masala Biryani',
        slug: 'tbh-mughlai-egg-biryani',
        category_slug: 'biryani',
        description: 'Two spice-scored boiled eggs pan-roasted in caramelized onion masala and steamed with fragrant dum basmati.',
        image_url: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 1',
        is_bestseller: false,
        base_price: '229.00',
      },
      {
        name: 'Murgh Reshmi Malai Kebab (6 Pcs)',
        slug: 'tbh-murgh-reshmi-malai-kebab',
        category_slug: 'starters',
        description: 'Melt-in-mouth boneless chicken morsels marinated in cream, cashew paste, cardamom and skewered over live charcoal.',
        image_url: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Mild',
        serves_info: 'Serves 2',
        is_bestseller: true,
        base_price: '275.00',
      },
      {
        name: 'Chennai Chicken 65 (Boneless)',
        slug: 'tbh-chennai-chicken-65',
        category_slug: 'starters',
        description: 'Iconic Bazaar-style crispy deep-fried spiced chicken tempered with crackling curry leaves and slit green chillies.',
        image_url: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 2',
        is_bestseller: true,
        base_price: '245.00',
      },
      {
        name: 'Lucknowi Mutton Galouti Kebab on Ulte Tawe ka Paratha',
        slug: 'tbh-mutton-galouti-kebab',
        category_slug: 'starters',
        description: 'Finely minced lamb patties infused with 32 royal Awadhi spices, pan-seared in ghee and served on saffron flatbread.',
        image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 2 (4 Pcs)',
        is_bestseller: false,
        base_price: '335.00',
      },
      {
        name: 'Nizami Mutton Rogan Josh',
        slug: 'tbh-mutton-rogan-josh',
        category_slug: 'north-indian',
        description: 'Slow-braised lamb shanks cooked in aromatic Kashmiri ratan jot and fennel gravy.',
        image_url: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 2',
        is_bestseller: false,
        base_price: '349.00',
      },
      {
        name: 'Shahi Double Ka Meetha',
        slug: 'tbh-shahi-double-ka-meetha',
        category_slug: 'desserts',
        description: 'Hyderabadi royal bread pudding soaked in saffron-cardamom rabri and topped with pistachio slivers.',
        image_url: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '129.00',
      },
      {
        name: 'Kesar Pista Badam Phirni',
        slug: 'tbh-kesar-pista-phirni',
        category_slug: 'desserts',
        description: 'Chilled stone-ground rice pudding set in an earthen kasora pot with Kashmir saffron and almonds.',
        image_url: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: false,
        base_price: '119.00',
      },
    ],
  },

  // 3. Urban Crust
  {
    name: 'Urban Crust',
    slug: 'urban-crust',
    description:
      '48-hour fermented Neapolitan sourdough pizzas baked at 450°C, handmade artisanal pastas, and truffle-infused sides. (Fictional demonstration brand)',
    cuisine: 'Pizza and Italian',
    image_url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80',
    banner_url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1400&q=80',
    rating: '4.65',
    review_count: 1180,
    price_range: '₹450 for two',
    is_featured: true,
    offer_badge: '20% OFF on Wood-Fired Pizzas',
    branches: [
      {
        branch_name: 'Urban Crust - Nungambakkam',
        branch_code: 'UC-NUNGAMBAKKAM',
        address: '19 Khader Nawaz Khan Road, Nungambakkam, Chennai 600006',
        locality: 'Nungambakkam',
        latitude: 13.0604,
        longitude: 80.2496,
        opening_hours: '11:30 AM - 11:30 PM',
        delivery_fee: '40.00',
        min_order_amount: '249.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 8.5,
        price_delta: 20,
        covered_localities: ['Nungambakkam', 'T. Nagar', 'Egmore', 'Kilpauk', 'Chetpet', 'Alwarpet', 'Mylapore'],
      },
      {
        branch_name: 'Urban Crust - OMR',
        branch_code: 'UC-OMR',
        address: '72 Rajiv Gandhi Salai (OMR), Thoraipakkam, Chennai 600097',
        locality: 'OMR',
        latitude: 12.9387,
        longitude: 80.2351,
        opening_hours: '11:30 AM - 11:45 PM',
        delivery_fee: '35.00',
        min_order_amount: '229.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 9.5,
        price_delta: 0,
        covered_localities: ['OMR', 'Thoraipakkam', 'Perungudi', 'Sholinganallur', 'Karapakkam', 'Velachery', 'Adyar'],
      },
      {
        branch_name: 'Urban Crust - Anna Nagar',
        branch_code: 'UC-ANNANAGAR',
        address: '4th Main Road, F Block, Anna Nagar East, Chennai 600102',
        locality: 'Anna Nagar',
        latitude: 13.0865,
        longitude: 80.2185,
        opening_hours: '11:30 AM - 11:30 PM',
        delivery_fee: '35.00',
        min_order_amount: '229.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 8.5,
        price_delta: 10,
        covered_localities: ['Anna Nagar', 'Kilpauk', 'Mogappair', 'Koyambedu', 'Shenoy Nagar', 'Aminjikarai'],
      },
    ],
    menu_items: [
      {
        name: 'Classic Margherita Fior di Latte (10")',
        slug: 'uc-margherita-fior-di-latte',
        category_slug: 'pizza',
        description: 'San Marzano crushed tomato sauce, fresh buffalo mozzarella bocconcini, sweet basil leaves & cold-pressed extra virgin olive oil.',
        image_url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2 (6 Slices)',
        is_bestseller: true,
        base_price: '329.00',
      },
      {
        name: 'Truffle Wild Mushroom & Burrata Pizza (10")',
        slug: 'uc-truffle-mushroom-burrata-pizza',
        category_slug: 'pizza',
        description: 'Roasted shiitake & cremini mushrooms, white truffle oil, thyme, aged parmesan and creamy burrata heart.',
        image_url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2 (6 Slices)',
        is_bestseller: true,
        base_price: '449.00',
      },
      {
        name: 'Smoky Peri-Peri Chicken & Jalapeno Pizza (10")',
        slug: 'uc-peri-peri-chicken-pizza',
        category_slug: 'pizza',
        description: 'Flame-grilled peri-peri chicken strips, pickled jalapenos, red paprika, caramelized onions and mozzarella.',
        image_url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 2 (6 Slices)',
        is_bestseller: true,
        base_price: '429.00',
      },
      {
        name: 'Diavola Spicy Chicken Pepperoni Pizza (10")',
        slug: 'uc-diavola-chicken-pepperoni-pizza',
        category_slug: 'pizza',
        description: 'Artisanal smoked chicken pepperoni, Calabrian chilli flakes, hot honey drizzle and aged mozzarella.',
        image_url: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 2 (6 Slices)',
        is_bestseller: true,
        base_price: '459.00',
      },
      {
        name: 'Mediterranean Farm Fresh Pesto Pizza (10")',
        slug: 'uc-mediterranean-pesto-pizza',
        category_slug: 'pizza',
        description: 'Genovese basil pesto base, sun-dried tomatoes, Kalamata olives, baby spinach, zucchini and crumbled feta.',
        image_url: 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2 (6 Slices)',
        is_bestseller: false,
        base_price: '389.00',
      },
      {
        name: 'Pull-Apart Cheesy Garlic Bread',
        slug: 'uc-cheesy-garlic-bread',
        category_slug: 'starters',
        description: 'Warm sourdough baguette baked with confit garlic herb butter, mozzarella pull and marinara dip.',
        image_url: 'https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2 (4 Pcs)',
        is_bestseller: true,
        base_price: '189.00',
      },
      {
        name: 'Penne Arrabbiata with Burrata Foam',
        slug: 'uc-penne-arrabbiata',
        category_slug: 'pizza',
        description: 'Durum wheat penne tossed in slow-simmered spicy garlic San Marzano tomato sauce, fresh basil and parmesan.',
        image_url: 'https://images.unsplash.com/photo-1621996346565-e3d5d6281298?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 1',
        is_bestseller: false,
        base_price: '289.00',
      },
      {
        name: 'Crispy Truffle Parmesan Arancini Balls',
        slug: 'uc-truffle-arancini-balls',
        category_slug: 'starters',
        description: 'Golden panko-crusted risotto spheres stuffed with molten mozzarella, served over spicy Pomodoro.',
        image_url: 'https://images.unsplash.com/photo-1541529086526-db283c563270?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2 (5 Pcs)',
        is_bestseller: false,
        base_price: '239.00',
      },
      {
        name: 'Classic Mascarpone Tiramisu Jar',
        slug: 'uc-mascarpone-tiramisu-jar',
        category_slug: 'desserts',
        description: 'Espresso-soaked savoiardi ladyfingers layered with whipped Italian mascarpone sabayon and Dutch cocoa.',
        image_url: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '219.00',
      },
      {
        name: 'Sicilian Blood Orange & Mint Sparkler',
        slug: 'uc-blood-orange-sparkler',
        category_slug: 'beverages',
        description: 'Refreshing sparkling citrus cooler infused with muddled mint leaves and Sicilian blood orange reduction.',
        image_url: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (300ml)',
        is_bestseller: false,
        base_price: '139.00',
      },
    ],
  },

  // 4. Wok & Roll
  {
    name: 'Wok & Roll',
    slug: 'wok-and-roll',
    description:
      'High-flame Asian street kitchen serving hand-folded dim sums, wok-charred Hakka noodles, and bold Sichuan bowls. (Fictional demonstration brand)',
    cuisine: 'Chinese and Asian',
    image_url: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=900&q=80',
    banner_url: 'https://images.unsplash.com/photo-1552611052-33e04de081de?auto=format&fit=crop&w=1400&q=80',
    rating: '4.55',
    review_count: 960,
    price_range: '₹300 for two',
    is_featured: false,
    offer_badge: 'COMBO: Free Starter on ₹449+',
    branches: [
      {
        branch_name: 'Wok & Roll - T. Nagar',
        branch_code: 'WR-TNAGAR',
        address: '88 GN Chetty Road, T. Nagar, Chennai 600017',
        locality: 'T. Nagar',
        latitude: 13.0452,
        longitude: 80.2398,
        opening_hours: '11:30 AM - 11:30 PM',
        delivery_fee: '30.00',
        min_order_amount: '179.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 8.5,
        price_delta: 0,
        covered_localities: ['T. Nagar', 'Nungambakkam', 'Mylapore', 'Alwarpet', 'Kodambakkam', 'Saidapet'],
      },
      {
        branch_name: 'Wok & Roll - Adyar',
        branch_code: 'WR-ADYAR',
        address: '27 LB Road, Indira Nagar, Adyar, Chennai 600020',
        locality: 'Adyar',
        latitude: 12.9968,
        longitude: 80.2544,
        opening_hours: '11:30 AM - 11:30 PM',
        delivery_fee: '35.00',
        min_order_amount: '179.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 8.5,
        price_delta: 10,
        covered_localities: ['Adyar', 'Besant Nagar', 'Thiruvanmiyur', 'Velachery', 'Guindy', 'Kotturpuram'],
      },
      {
        branch_name: 'Wok & Roll - Porur',
        branch_code: 'WR-PORUR',
        address: '104 Mount Poonamallee High Road, Porur, Chennai 600116',
        locality: 'Porur',
        latitude: 13.0382,
        longitude: 80.1565,
        opening_hours: '11:30 AM - 11:00 PM',
        delivery_fee: '30.00',
        min_order_amount: '159.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 8.5,
        price_delta: -10,
        covered_localities: ['Porur', 'Ramapuram', 'Valasaravakkam', 'Vadapalani', 'Guindy', 'Iyyappanthangal'],
      },
    ],
    menu_items: [
      {
        name: 'Szechuan Chilli Garlic Hakka Noodles (Veg)',
        slug: 'wr-szechuan-hakka-noodles-veg',
        category_slug: 'chinese',
        description: 'Wok-tossed noodles with julienned bell peppers, bok choy, spring onions and house-made fiery Sichuan chilli oil.',
        image_url: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Spicy',
        serves_info: 'Serves 1-2',
        is_bestseller: true,
        base_price: '219.00',
      },
      {
        name: 'Smoky Burnt Garlic Chicken Fried Rice',
        slug: 'wr-burnt-garlic-chicken-fried-rice',
        category_slug: 'chinese',
        description: 'Jasmine rice wok-seared over high flame with diced chicken, crispy golden garlic chips, egg and scallion greens.',
        image_url: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 1-2',
        is_bestseller: true,
        base_price: '249.00',
      },
      {
        name: 'Kung Pao Chicken with Roasted Cashews',
        slug: 'wr-kung-pao-chicken',
        category_slug: 'chinese',
        description: 'Wok-glazed diced chicken with dried Sichuan red chillies, toasted cashews, bell peppers and dark soy reduction.',
        image_url: 'https://images.unsplash.com/photo-1525755662778-989d0524087e?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 2',
        is_bestseller: true,
        base_price: '289.00',
      },
      {
        name: 'Crispy Honey Chilli Lotus Stem',
        slug: 'wr-honey-chilli-lotus-stem',
        category_slug: 'starters',
        description: 'Thinly sliced crunchy lotus root glazed in wildflower honey, crushed red chillies and toasted white sesame seeds.',
        image_url: 'https://images.unsplash.com/photo-1541529086526-db283c563270?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 2',
        is_bestseller: true,
        base_price: '239.00',
      },
      {
        name: 'Crystal Vegetable & Water Chestnut Dim Sum (6 Pcs)',
        slug: 'wr-crystal-veg-dim-sum',
        category_slug: 'starters',
        description: 'Translucent steamed dumplings filled with crunchy water chestnuts, shiitake mushrooms & bamboo shoots.',
        image_url: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1-2 (6 Pcs)',
        is_bestseller: true,
        base_price: '229.00',
      },
      {
        name: 'Spicy Chicken & Chive Gyoza Dumplings (6 Pcs)',
        slug: 'wr-chicken-gyoza-dumplings',
        category_slug: 'starters',
        description: 'Pan-seared Japanese style dumplings stuffed with minced ginger chicken and garlic chives, served with chilli ponzu.',
        image_url: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 1-2 (6 Pcs)',
        is_bestseller: false,
        base_price: '259.00',
      },
      {
        name: 'Classic Chilli Paneer Dry',
        slug: 'wr-chilli-paneer-dry',
        category_slug: 'starters',
        description: 'Silky batter-fried cottage cheese cubes tossed with green chillies, soy-vinegar glaze, garlic and capsicum.',
        image_url: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Spicy',
        serves_info: 'Serves 2',
        is_bestseller: false,
        base_price: '245.00',
      },
      {
        name: 'Thai Green Curry with Steamed Jasmine Rice (Veg)',
        slug: 'wr-thai-green-curry-jasmine-rice',
        category_slug: 'chinese',
        description: 'Fragrant coconut milk curry simmered with galangal, kaffir lime leaves, Thai basil & exotic veggies.',
        image_url: 'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 1-2',
        is_bestseller: false,
        base_price: '299.00',
      },
      {
        name: 'Drums of Heaven (Crispy Lollipops 6 Pcs)',
        slug: 'wr-drums-of-heaven',
        category_slug: 'starters',
        description: 'Frenched chicken wingettes crisp-fried and tossed in sweet-spicy Schezwan garlic glaze.',
        image_url: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 2 (6 Pcs)',
        is_bestseller: true,
        base_price: '269.00',
      },
      {
        name: 'Yuzu Peach Iced Green Tea',
        slug: 'wr-yuzu-peach-iced-tea',
        category_slug: 'beverages',
        description: 'Cold-brewed jasmine green tea shaken with Japanese yuzu citrus and white peach puree.',
        image_url: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (350ml)',
        is_bestseller: false,
        base_price: '129.00',
      },
    ],
  },

  // 5. Burger District
  {
    name: 'Burger District',
    slug: 'burger-district',
    description:
      'Crafted smash burgers on toasted Hokkaido brioche buns, Nashville hot chicken tenders, and loaded cheese fries. (Fictional demonstration brand)',
    cuisine: 'Burgers and Fast Food',
    image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80',
    banner_url: 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1400&q=80',
    rating: '4.50',
    review_count: 1640,
    price_range: '₹300 for two',
    is_featured: true,
    offer_badge: 'FREE Peri-Peri Fries on ₹399+',
    branches: [
      {
        branch_name: 'Burger District - Velachery',
        branch_code: 'BD-VELACHERY',
        address: '61 Taramani Link Road, Velachery, Chennai 600042',
        locality: 'Velachery',
        latitude: 12.9815,
        longitude: 80.2229,
        opening_hours: '11:00 AM - 01:00 AM',
        delivery_fee: '30.00',
        min_order_amount: '149.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 9.0,
        price_delta: 0,
        covered_localities: ['Velachery', 'Adyar', 'Guindy', 'Taramani', 'Perungudi', 'Madipakkam', 'OMR'],
      },
      {
        branch_name: 'Burger District - OMR',
        branch_code: 'BD-OMR',
        address: '145 OMR Food Street, Navallur / Sholinganallur Link, Chennai 600119',
        locality: 'OMR',
        latitude: 12.901,
        longitude: 80.2279,
        opening_hours: '11:00 AM - 01:00 AM',
        delivery_fee: '35.00',
        min_order_amount: '159.00',
        estimated_delivery_time: '25-35 mins',
        delivery_radius_km: 9.5,
        price_delta: 5,
        covered_localities: ['OMR', 'Sholinganallur', 'Thoraipakkam', 'Karapakkam', 'Perungudi', 'Medavakkam'],
      },
      {
        branch_name: 'Burger District - Anna Nagar',
        branch_code: 'BD-ANNANAGAR',
        address: '12 3rd Avenue, W Block, Anna Nagar, Chennai 600040',
        locality: 'Anna Nagar',
        latitude: 13.0842,
        longitude: 80.2145,
        opening_hours: '11:00 AM - 12:30 AM',
        delivery_fee: '35.00',
        min_order_amount: '159.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 8.5,
        price_delta: 10,
        covered_localities: ['Anna Nagar', 'Kilpauk', 'Mogappair', 'Koyambedu', 'Aminjikarai', 'Vadapalani'],
      },
    ],
    menu_items: [
      {
        name: 'Nashville Hot Crispy Chicken Burger',
        slug: 'bd-nashville-hot-chicken-burger',
        category_slug: 'burgers',
        description: 'Buttermilk-brined crunchy fried chicken thigh glazed in cayenne chili oil, house dill pickles, slaw & chipotle aioli on brioche.',
        image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '249.00',
      },
      {
        name: 'Double Truffle Smashed Tenderloin Burger',
        slug: 'bd-double-truffle-smash-burger',
        category_slug: 'burgers',
        description: 'Two lacy-edged smashed patties, double aged American cheddar, caramelized jammy onions and black truffle mayo.',
        image_url: 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '299.00',
      },
      {
        name: 'Crunchy Korean Gochujang Paneer Burger',
        slug: 'bd-korean-gochujang-paneer-burger',
        category_slug: 'burgers',
        description: 'Thick panko-crusted paneer steak glazed in sweet-spicy Korean gochujang sauce, kimchi slaw and cheddar.',
        image_url: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Spicy',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '229.00',
      },
      {
        name: 'Classic Herb Crusted Veg & Cheddar Burger',
        slug: 'bd-classic-veg-cheddar-burger',
        category_slug: 'burgers',
        description: 'Golden potato-green pea-sweet corn patty, iceberg lettuce, vine-ripened tomato, red onion rings and secret burger sauce.',
        image_url: 'https://images.unsplash.com/photo-1520072959219-c595dc870360?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: false,
        base_price: '179.00',
      },
      {
        name: 'Smoky BBQ Pulled Chicken & Onion Ring Burger',
        slug: 'bd-bbq-pulled-chicken-burger',
        category_slug: 'burgers',
        description: 'Hickory smoked pulled chicken, beer-battered crispy onion rings, smoked gouda cheese and tangy BBQ glaze.',
        image_url: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Medium',
        serves_info: 'Serves 1',
        is_bestseller: false,
        base_price: '259.00',
      },
      {
        name: 'Loaded Jalapeno & Liquid Cheese Crinkle Fries',
        slug: 'bd-loaded-cheese-crinkle-fries',
        category_slug: 'starters',
        description: 'Crispy crinkle-cut skin-on fries smothered in warm aged cheddar cheese sauce, pickled jalapenos and cajun dust.',
        image_url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Medium',
        serves_info: 'Serves 2',
        is_bestseller: true,
        base_price: '169.00',
      },
      {
        name: 'Peri-Peri Popcorn Chicken Bucket',
        slug: 'bd-peri-peri-popcorn-chicken',
        category_slug: 'starters',
        description: 'Bite-sized crispy buttermilk chicken bites tossed in African bird’s eye peri-peri seasoning with garlic mayo dip.',
        image_url: 'https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=600&q=80',
        is_veg: false,
        spice_level: 'Spicy',
        serves_info: 'Serves 1-2',
        is_bestseller: true,
        base_price: '199.00',
      },
      {
        name: 'Mozzarella & Herb Cheese Sticks (6 Pcs)',
        slug: 'bd-mozzarella-cheese-sticks',
        category_slug: 'starters',
        description: 'Italian herb-breaded mozzarella sticks fried to golden perfection with spicy marinara dip.',
        image_url: 'https://images.unsplash.com/photo-1531749668029-2db88e4276c7?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 2',
        is_bestseller: false,
        base_price: '185.00',
      },
      {
        name: 'Belgian Chocolate Fudge Oreo Thickshake',
        slug: 'bd-chocolate-oreo-thickshake',
        category_slug: 'beverages',
        description: 'Hand-spun Madagascar vanilla & dark chocolate gelato blended with crushed Oreo cookies and whipped cream.',
        image_url: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (350ml)',
        is_bestseller: true,
        base_price: '179.00',
      },
      {
        name: 'Warm Salted Caramel Skillet Cookie Sundae',
        slug: 'bd-salted-caramel-cookie-sundae',
        category_slug: 'desserts',
        description: 'Gooey chocolate chunk cookie baked fresh, topped with vanilla bean ice cream and sea-salt caramel drizzle.',
        image_url: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1-2',
        is_bestseller: false,
        base_price: '189.00',
      },
    ],
  },

  // 6. Sweet Theory
  {
    name: 'Sweet Theory',
    slug: 'sweet-theory',
    description:
      'Boutique patisserie & beverage bar crafting San Sebastian burnt cheesecakes, Belgian liege waffles, and specialty cold brews. (Fictional demonstration brand)',
    cuisine: 'Desserts and Beverages',
    image_url: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80',
    banner_url: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1400&q=80',
    rating: '4.80',
    review_count: 1890,
    price_range: '₹280 for two',
    is_featured: true,
    offer_badge: 'FLAT 15% OFF on Dessert Boxes',
    branches: [
      {
        branch_name: 'Sweet Theory - Adyar',
        branch_code: 'ST-ADYAR',
        address: '9 1st Main Road, Gandhi Nagar, Adyar, Chennai 600020',
        locality: 'Adyar',
        latitude: 13.0067,
        longitude: 80.2548,
        opening_hours: '09:00 AM - 12:00 AM',
        delivery_fee: '30.00',
        min_order_amount: '149.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 8.5,
        price_delta: 0,
        covered_localities: ['Adyar', 'Besant Nagar', 'Thiruvanmiyur', 'Mylapore', 'Kotturpuram', 'Velachery', 'Guindy'],
      },
      {
        branch_name: 'Sweet Theory - Nungambakkam',
        branch_code: 'ST-NUNGAMBAKKAM',
        address: '31 Wallace Garden 2nd Street, Nungambakkam, Chennai 600006',
        locality: 'Nungambakkam',
        latitude: 13.0628,
        longitude: 80.2512,
        opening_hours: '09:00 AM - 12:00 AM',
        delivery_fee: '35.00',
        min_order_amount: '159.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 8.5,
        price_delta: 15,
        covered_localities: ['Nungambakkam', 'T. Nagar', 'Egmore', 'Kilpauk', 'Alwarpet', 'Mylapore', 'Anna Nagar'],
      },
      {
        branch_name: 'Sweet Theory - Tambaram',
        branch_code: 'ST-TAMBARAM',
        address: '18 Velachery Main Road, East Tambaram, Chennai 600059',
        locality: 'Tambaram',
        latitude: 12.9229,
        longitude: 80.1275,
        opening_hours: '09:30 AM - 11:30 PM',
        delivery_fee: '25.00',
        min_order_amount: '129.00',
        estimated_delivery_time: '20-30 mins',
        delivery_radius_km: 8.5,
        price_delta: -10,
        covered_localities: ['Tambaram', 'Chromepet', 'Selaiyur', 'Pallavaram', 'Medavakkam', 'Perungalathur'],
      },
    ],
    menu_items: [
      {
        name: 'San Sebastian Burnt Basque Cheesecake Slice',
        slug: 'st-burnt-basque-cheesecake',
        category_slug: 'desserts',
        description: 'Caramelized high-temp baked crust with a creamy custard center, served with warm 54% Belgian dark chocolate pour-over.',
        image_url: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '249.00',
      },
      {
        name: 'Lotus Biscoff & White Chocolate Liege Waffle',
        slug: 'st-lotus-biscoff-waffle',
        category_slug: 'desserts',
        description: 'Crisp pearl-sugar Belgian waffle topped with warm Lotus Biscoff spread, melted white chocolate and speculoos crumble.',
        image_url: 'https://images.unsplash.com/photo-1562376552-0d160a2f238d?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '195.00',
      },
      {
        name: 'Triple Belgian Chocolate Hazelnut Brownie',
        slug: 'st-triple-chocolate-hazelnut-brownie',
        category_slug: 'desserts',
        description: 'Fudgy dark couverture brownie studded with roasted Piedmont hazelnuts and Nutella drizzle.',
        image_url: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '165.00',
      },
      {
        name: 'Kunafa Pistachio Chocolate Croissant Cube',
        slug: 'st-kunafa-pistachio-croissant',
        category_slug: 'desserts',
        description: 'Flaky 27-layer butter croissant filled with crispy golden kataifi kunafa and Iranian pistachio praline cream.',
        image_url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: true,
        base_price: '259.00',
      },
      {
        name: 'Madagascar Vanilla Tres Leches Cake Tub',
        slug: 'st-vanilla-tres-leches-tub',
        category_slug: 'desserts',
        description: 'Feather-light sponge soaked in three milks infused with Madagascar vanilla bean pods and chantilly cream.',
        image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1-2',
        is_bestseller: false,
        base_price: '225.00',
      },
      {
        name: 'Vietnamese Condensed Milk Iced Cold Brew',
        slug: 'st-vietnamese-iced-cold-brew',
        category_slug: 'beverages',
        description: '18-hour steeped Chikmagalur single-estate arabica cold brew layered over sweetened condensed milk.',
        image_url: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (300ml)',
        is_bestseller: true,
        base_price: '169.00',
      },
      {
        name: 'Alphonso Mango & Passionfruit Boba Smoothie',
        slug: 'st-mango-passionfruit-boba',
        category_slug: 'beverages',
        description: 'Thick Ratnagiri Alphonso mango blend swirled with tart passionfruit popping boba pearls.',
        image_url: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (350ml)',
        is_bestseller: false,
        base_price: '189.00',
      },
      {
        name: 'Uji Ceremonial Matcha Vanilla Iced Latte',
        slug: 'st-uji-matcha-iced-latte',
        category_slug: 'beverages',
        description: 'First-harvest Japanese Uji matcha whisked to micro-foam and poured over chilled milk and vanilla syrup.',
        image_url: 'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (300ml)',
        is_bestseller: false,
        base_price: '199.00',
      },
      {
        name: 'Strawberry Nutella Pancake Stack (6 Mini)',
        slug: 'st-strawberry-nutella-pancakes',
        category_slug: 'desserts',
        description: 'Fluffy soufflé mini pancakes topped with fresh Mahabaleshwar strawberries, Nutella and maple butter.',
        image_url: 'https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1',
        is_bestseller: false,
        base_price: '185.00',
      },
      {
        name: 'Salted Pistachio & Rose Milkshake',
        slug: 'st-pistachio-rose-milkshake',
        category_slug: 'beverages',
        description: 'Rich roasted pistachio gelato blended with organic damask rose water and crushed nuts.',
        image_url: 'https://images.unsplash.com/photo-1577805947697-89e18249d767?auto=format&fit=crop&w=600&q=80',
        is_veg: true,
        spice_level: 'Mild',
        serves_info: 'Serves 1 (350ml)',
        is_bestseller: false,
        base_price: '185.00',
      },
    ],
  },
];

function createCirclePolygonGeoJSON(lat: number, lng: number, radiusKm: number) {
  const points = 16;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.sin(angle);
    const dLng = (radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle);
    coords.push([Number((lng + dLng).toFixed(6)), Number((lat + dLat).toFixed(6))]);
  }
  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}

export async function runSeed(targetPool: pg.Pool = pool): Promise<void> {
  await runMigrations(targetPool);
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Seed Categories
    const categoryIdBySlug = new Map<string, string>();
    for (const cat of CATEGORIES_SEED) {
      const res = await client.query(
        `INSERT INTO food_categories (name, slug, description, image_url, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           image_url = EXCLUDED.image_url,
           display_order = EXCLUDED.display_order,
           updated_at = now()
         RETURNING id`,
        [cat.name, cat.slug, cat.description, cat.image_url, cat.display_order]
      );
      categoryIdBySlug.set(cat.slug, res.rows[0].id);
    }

    // 2. Seed Restaurants, Branches, Delivery Zones, Menu Items, and Branch-Menu Links
    let totalBranches = 0;
    let totalMenuItems = 0;
    let totalBranchMenuItems = 0;

    for (const rest of RESTAURANTS_SEED) {
      const restRes = await client.query(
        `INSERT INTO restaurants (
           name, slug, description, cuisine, image_url, banner_url,
           rating, review_count, price_range, is_featured, offer_badge, is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           cuisine = EXCLUDED.cuisine,
           image_url = EXCLUDED.image_url,
           banner_url = EXCLUDED.banner_url,
           rating = EXCLUDED.rating,
           review_count = EXCLUDED.review_count,
           price_range = EXCLUDED.price_range,
           is_featured = EXCLUDED.is_featured,
           offer_badge = EXCLUDED.offer_badge,
           updated_at = now()
         RETURNING id`,
        [
          rest.name,
          rest.slug,
          rest.description,
          rest.cuisine,
          rest.image_url,
          rest.banner_url,
          rest.rating,
          rest.review_count,
          rest.price_range,
          rest.is_featured,
          rest.offer_badge,
        ]
      );
      const restaurantId: string = restRes.rows[0].id;

      // Insert Branches & Delivery Zones
      const branchRecords: { id: string; seed: BranchSeed }[] = [];
      for (const b of rest.branches) {
        const contactPhone = b.contact_phone || BRANCH_CONTACT_PHONES[b.branch_code] || '+91 44 2815 4200';
        const bRes = await client.query(
          `INSERT INTO restaurant_branches (
             restaurant_id, branch_name, branch_code, address, locality, city,
             latitude, longitude, opening_hours, contact_phone, delivery_fee, min_order_amount,
             estimated_delivery_time, delivery_radius_km, is_delivery_available, is_active
           )
           VALUES ($1, $2, $3, $4, $5, 'Chennai', $6, $7, $8, $9, $10, $11, $12, $13, true, true)
           ON CONFLICT (branch_code) DO UPDATE SET
             restaurant_id = EXCLUDED.restaurant_id,
             branch_name = EXCLUDED.branch_name,
             address = EXCLUDED.address,
             locality = EXCLUDED.locality,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             opening_hours = EXCLUDED.opening_hours,
             contact_phone = EXCLUDED.contact_phone,
             delivery_fee = EXCLUDED.delivery_fee,
             min_order_amount = EXCLUDED.min_order_amount,
             estimated_delivery_time = EXCLUDED.estimated_delivery_time,
             delivery_radius_km = EXCLUDED.delivery_radius_km,
             updated_at = now()
           RETURNING id`,
          [
            restaurantId,
            b.branch_name,
            b.branch_code,
            b.address,
            b.locality,
            b.latitude,
            b.longitude,
            b.opening_hours,
            contactPhone,
            b.delivery_fee,
            b.min_order_amount,
            b.estimated_delivery_time,
            b.delivery_radius_km,
          ]
        );
        const branchId: string = bRes.rows[0].id;
        branchRecords.push({ id: branchId, seed: b });
        totalBranches++;

        const polygon = createCirclePolygonGeoJSON(b.latitude, b.longitude, b.delivery_radius_km);
        await client.query(
          `INSERT INTO delivery_zones (
             branch_id, zone_name, city, center_latitude, center_longitude,
             max_radius_km, polygon_geojson, covered_localities, is_active
           )
           VALUES ($1, $2, 'Chennai', $3, $4, $5, $6, $7, true)
           ON CONFLICT (branch_id, zone_name) DO UPDATE SET
             center_latitude = EXCLUDED.center_latitude,
             center_longitude = EXCLUDED.center_longitude,
             max_radius_km = EXCLUDED.max_radius_km,
             polygon_geojson = EXCLUDED.polygon_geojson,
             covered_localities = EXCLUDED.covered_localities,
             updated_at = now()`,
          [
            branchId,
            `${b.locality} Delivery Zone (${b.delivery_radius_km} km)`,
            b.latitude,
            b.longitude,
            b.delivery_radius_km,
            JSON.stringify(polygon),
            b.covered_localities,
          ]
        );
      }

      // Insert Menu Items for this Restaurant Brand
      for (let idx = 0; idx < rest.menu_items.length; idx++) {
        const item = rest.menu_items[idx];
        const categoryId = categoryIdBySlug.get(item.category_slug);
        if (!categoryId) {
          throw new Error(`Category slug not found: ${item.category_slug}`);
        }
        const mRes = await client.query(
          `INSERT INTO menu_items (
             restaurant_id, category_id, name, slug, description, image_url,
             is_veg, spice_level, serves_info, is_bestseller, base_price, is_available
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
           ON CONFLICT (slug) DO UPDATE SET
             restaurant_id = EXCLUDED.restaurant_id,
             category_id = EXCLUDED.category_id,
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             image_url = EXCLUDED.image_url,
             is_veg = EXCLUDED.is_veg,
             spice_level = EXCLUDED.spice_level,
             serves_info = EXCLUDED.serves_info,
             is_bestseller = EXCLUDED.is_bestseller,
             base_price = EXCLUDED.base_price,
             updated_at = now()
           RETURNING id`,
          [
            restaurantId,
            categoryId,
            item.name,
            item.slug,
            item.description,
            item.image_url,
            item.is_veg,
            item.spice_level,
            item.serves_info,
            item.is_bestseller,
            item.base_price,
          ]
        );
        const menuItemId: string = mRes.rows[0].id;
        totalMenuItems++;

        // Link to each branch with branch-specific pricing & availability
        for (let bIdx = 0; bIdx < branchRecords.length; bIdx++) {
          const br = branchRecords[bIdx];
          const baseCents = Math.round(parseFloat(item.base_price) * 100);
          const deltaCents = Math.round(br.seed.price_delta * 100);
          const effectiveCents = Math.max(5000, baseCents + deltaCents);
          const effectivePriceStr = (effectiveCents / 100).toFixed(2);
          const priceOverrideStr = deltaCents !== 0 ? effectivePriceStr : null;

          // Make the 10th item (idx === 9) on the 3rd branch (bIdx === 2) unavailable
          // so branch-specific unavailability is realistically demonstrated and testable!
          const isAvailableAtBranch = !(idx === 9 && bIdx === 2);
          const stockStatus = isAvailableAtBranch ? 'IN_STOCK' : 'SOLD_OUT_FOR_TODAY';

          await client.query(
            `INSERT INTO branch_menu_items (
               branch_id, menu_item_id, price_override, effective_price,
               is_available, stock_status, featured_at_branch
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (branch_id, menu_item_id) DO UPDATE SET
               price_override = EXCLUDED.price_override,
               effective_price = EXCLUDED.effective_price,
               is_available = EXCLUDED.is_available,
               stock_status = EXCLUDED.stock_status,
               featured_at_branch = EXCLUDED.featured_at_branch,
               updated_at = now()`,
            [
              br.id,
              menuItemId,
              priceOverrideStr,
              effectivePriceStr,
              isAvailableAtBranch,
              stockStatus,
              item.is_bestseller,
            ]
          );
          totalBranchMenuItems++;
        }
      }
    }

    // 3. Seed Demo Admin and Customer accounts (idempotent)
    const adminHash = await bcrypt.hash('Admin@1234', 10);
    await client.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES ('CraveKart Database Admin', 'admin@cravekart.in', '+919840011111', $1, 'ADMIN')
       ON CONFLICT (email) DO UPDATE SET
         role = 'ADMIN',
         updated_at = now()`,
      [adminHash]
    );

    const demoCustomerHash = await bcrypt.hash('Crave@1234', 10);
    const demoUserRes = await client.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES ('Arjun Krishnamurthy', 'arjun@cravekart.in', '+919840022222', $1, 'CUSTOMER')
       ON CONFLICT (email) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         updated_at = now()
       RETURNING id`,
      [demoCustomerHash]
    );
    const demoUserId = demoUserRes.rows[0].id;

    // Ensure the demo user has at least one validated Chennai address
    const existingAddr = await client.query(
      'SELECT id FROM user_addresses WHERE user_id = $1 LIMIT 1',
      [demoUserId]
    );
    if (existingAddr.rowCount === 0) {
      await client.query(
        `INSERT INTO user_addresses (
           user_id, address_label, formatted_address, place_id,
           latitude, longitude, house_flat_no, building_name,
           floor_number, landmark, delivery_instructions,
           locality, city, postal_code, validation_source, is_default
         )
         VALUES (
           $1, 'Home',
           'Panagal Park, Usman Road, T. Nagar, Chennai, Tamil Nadu 600017, India',
           'ChIJN5X_g2VnUjoR_demo_tnagar_chennai',
           13.0418000, 80.2341000,
           'Flat 4B', 'Kaveri Residency', '4th Floor',
           'Opposite Panagal Park Arch', 'Ring doorbell once; leave with security if on call',
           'T. Nagar', 'Chennai', '600017', 'GOOGLE_PLACES_VERIFIED', true
         )`,
        [demoUserId]
      );
    }

    await client.query('COMMIT');
    console.log(
      `[CockroachDB Seed] Seeded ${CATEGORIES_SEED.length} categories, ${RESTAURANTS_SEED.length} restaurant brands, ${totalBranches} branches, ${totalMenuItems} menu items, and ${totalBranchMenuItems} branch-menu items.`
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/seed.ts');
if (isMain) {
  (async () => {
    try {
      const info = await verifyCockroachConnection();
      console.log(`[CockroachDB] Connected to: ${info.version}`);
      await runSeed(pool);
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('[CockroachDB Seed Error]:', err);
      process.exit(1);
    }
  })();
}
