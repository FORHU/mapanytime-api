import { PrismaClient } from '@prisma/client';

export async function seedCategories(prisma: PrismaClient) {
  console.log('🌱 Seeding Global Categories (idempotent upserts)...');

  const categoriesToSeed = [
    {
      name: 'Food & Beverage',
      description: 'Restaurants, cafes, groceries, and food stalls',
      subCategories: ['Food', 'Beverage', 'Fresh Produce', 'Packaged', 'Prepared', 'Ingredients'],
    },
    {
      name: 'Fashion & Cosmetics',
      description: 'Apparel, accessories, jewelry, beauty, and personal care products',
      subCategories: [
        "Men's Clothing",
        "Women's Clothing",
        'Shoes',
        'Bags',
        'Accessories',
        'Jewelry',
        'Watches',
        'Beauty',
        'Cosmetics',
        'Skincare',
        'Haircare',
        'Body Care',
        'Perfumes',
        'Nail Care',
        'Personal Care',
        'Beauty Tools',
      ],
    },
    {
      name: 'Electronics',
      description: 'Gadgets, appliances, and tech accessories',
      subCategories: [
        'Mobile Devices',
        'Computers',
        'Audio',
        'Cameras',
        'Gaming',
        'Home Entertainment',
        'Smart Devices',
        'Appliances',
        'Electronics Accessories',
      ],
    },
    {
      name: 'Home & Living',
      description: 'Furniture, hardware, and home improvement',
      subCategories: [
        'Furniture',
        'Home Decor',
        'Kitchen & Dining',
        'Bedding & Bath',
        'Storage & Organization',
        'Lighting',
        'Hardware',
        'Tools',
        'Building Materials',
        'Paint & Supplies',
        'Plumbing',
        'Electrical',
        'Cleaning & Household',
        'Garden & Outdoor',
        'Plants & Flowers',
        'Home Safety',
        'Other Home & Living',
      ],
    },
    {
      name: 'Health & Wellness',
      description: 'Pharmacies, medical suppliers, and fitness product retailers',
      subCategories: [
        'Medicines',
        'Medical Supplies',
        'Medical Devices',
        'First Aid',
        'Vitamins & Supplements',
        'Personal Care',
        'Oral Care',
        'Vision Care',
        'Hearing Care',
        'Mobility & Support',
        'Fitness Equipment',
        'Fitness Accessories',
        'Sports Nutrition',
        'Wellness Products',
        'Hygiene Products',
        'Maternity & Baby Care',
        'Elderly Care',
        'Other Health & Wellness',
      ],
    },
    {
      name: 'Automotive',
      description: 'Vehicles, parts, and automotive products',
      subCategories: [
        'Cars',
        'Motorcycles',
        'Bicycles',
        'Trucks',
        'Vans',
        'Tires & Wheels',
        'Auto Parts',
        'Motorcycle Parts',
        'Bicycle Parts',
        'Car Accessories',
        'Motorcycle Accessories',
        'Bicycle Accessories',
        'Tools & Equipment',
        'Oils & Fluids',
        'Batteries',
        'Lighting',
        'Cleaning & Care',
        'Safety Equipment',
      ],
    },
    {
      name: 'Pets',
      description: 'Pet food, supplies, equipment, and accessories',
      subCategories: [
        'Pet Food',
        'Pet Treats',
        'Pet Toys',
        'Pet Supplies',
        'Pet Accessories',
        'Pet Grooming Products',
        'Pet Health Products',
        'Pet Bedding',
        'Pet Cages & Enclosures',
        'Aquarium Supplies',
      ],
    },
    {
      name: 'Sports & Outdoors',
      description: 'Sporting goods, fitness equipment, and outdoor products',
      subCategories: [
        'Sports Equipment',
        'Fitness Equipment',
        'Sportswear',
        'Sports Footwear',
        'Sports Accessories',
        'Camping Equipment',
        'Hiking & Outdoor Gear',
        'Fishing Equipment',
        'Cycling Equipment',
        'Water Sports',
        'Outdoor Recreation',
      ],
    },
    {
      name: 'Entertainment',
      description: 'Media, games, hobbies, and creative products',
      subCategories: [
        'Music',
        'Movies & Media',
        'Video Games',
        'Board Games',
        'Toys & Games',
        'Hobbies',
        'Arts & Crafts',
        'Musical Instruments',
        'Collectibles',
        'Party & Event Supplies',
      ],
    },
    {
      name: 'Baby & Kids',
      description: 'Baby, maternity, and children products',
      subCategories: [
        'Baby Clothing',
        'Baby Food',
        'Baby Care',
        'Baby Gear',
        'Baby Toys',
        'Maternity Products',
        'Kids Clothing',
        'Kids Footwear',
        'Kids Accessories',
        'Kids School Supplies',
        'Nursery Products',
      ],
    },
    {
      name: 'Agriculture',
      description: 'Farming, gardening, and agricultural products',
      subCategories: [
        'Seeds',
        'Fertilizers',
        'Soil & Growing Media',
        'Farm Tools',
        'Farm Equipment',
        'Irrigation Equipment',
        'Animal Feed',
        'Livestock Supplies',
        'Crop Protection',
        'Harvesting Supplies',
        'Greenhouse Supplies',
      ],
    },
    {
      name: 'Industrial & Business',
      description: 'Industrial equipment, commercial supplies, and business products',
      subCategories: [
        'Industrial Equipment',
        'Machinery',
        'Tools',
        'Safety Equipment',
        'Packaging Supplies',
        'Storage Equipment',
        'Material Handling',
        'Cleaning Supplies',
        'Commercial Equipment',
        'Office Equipment',
        'Wholesale Products',
      ],
    },
    {
      name: 'Others',
      description: 'Miscellaneous products and specialty items',
      subCategories: [
        'General Merchandise',
        'Specialty Products',
        'Novelty Products',
        'Collectibles',
        'Seasonal Products',
        'Miscellaneous Products',
        'Other Products',
      ],
    },
  ];

  for (const parent of categoriesToSeed) {
    let rootCategory = await prisma.categories.findFirst({
      where: { name: parent.name, parentId: null },
    });

    if (rootCategory) {
      rootCategory = await prisma.categories.update({
        where: { id: rootCategory.id },
        data: { description: parent.description },
      });
    } else {
      rootCategory = await prisma.categories.create({
        data: {
          name: parent.name,
          description: parent.description,
        },
      });
    }

    await prisma.commissionRules.upsert({
      where: { categoryId: rootCategory.id },
      update: { commissionRate: 0.05, fixedFee: 10.0 },
      create: {
        categoryId: rootCategory.id,
        commissionRate: 0.05,
        fixedFee: 10.0,
        isActive: true,
      },
    });

    // Upsert each child sub-category and link to parent
    for (const subName of parent.subCategories) {
      const existingSub = await prisma.categories.findFirst({
        where: { name: subName, parentId: rootCategory.id },
      });
      if (existingSub) {
        await prisma.categories.update({
          where: { id: existingSub.id },
          data: { parentId: rootCategory.id },
        });
      } else {
        await prisma.categories.create({
          data: { name: subName, parentId: rootCategory.id },
        });
      }
    }
  }

  console.log('✅ Global hierarchical categories seeded!');
}
