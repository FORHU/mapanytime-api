import { PrismaClient } from '@prisma/client';

export async function seedCategories(prisma: PrismaClient) {
  console.log('🌱 Clearing old categories...');
  await prisma.categories.deleteMany();

  console.log('🌱 Seeding Global Categories...');

  const categoriesToSeed = [
    {
      name: 'Food & Beverage',
      description: 'Restaurants, cafes, groceries, and food stalls',
      subCategories: [
        'Restaurant',
        'Cafe',
        'Bakery',
        'Fast Food',
        'Grocery',
        'Fruits',
        'Vegetables',
        'Seafood',
        'Meat',
        'Dairy',
        'Beverages',
        'Liquor',
      ],
    },
    {
      name: 'Shopping & Retail',
      description: 'Apparel, accessories, cosmetics, and general retail',
      subCategories: [
        'Fashion',
        'Shoes',
        'Bags',
        'Accessories',
        'Jewelry',
        'Watches',
        'Beauty',
        'Cosmetics',
        'Perfumes',
        'Toys',
        'Gifts',
        'Bookstore',
        'Stationery',
        'Office Supplies',
      ],
    },
    {
      name: 'Electronics',
      description: 'Gadgets, appliances, and tech accessories',
      subCategories: [
        'General Electronics',
        'Mobile Phones',
        'Computers',
        'Gaming',
        'Appliances',
        'Cameras',
      ],
    },
    {
      name: 'Home & Living',
      description: 'Furniture, hardware, and home improvement',
      subCategories: [
        'Furniture',
        'Home Decor',
        'Kitchen',
        'Bedding',
        'Hardware',
        'Construction',
        'Paint',
        'Plumbing',
        'Electrical',
        'Garden',
        'Flowers',
      ],
    },
    {
      name: 'Health & Wellness',
      description: 'Pharmacies, clinics, and fitness centers',
      subCategories: [
        'Pharmacy',
        'Medical Supplies',
        'Clinic',
        'Dental',
        'Optical',
        'Fitness',
        'Supplements',
      ],
    },
    {
      name: 'Automotive',
      description: 'Vehicles, parts, and automotive services',
      subCategories: [
        'General Automotive',
        'Motorcycles',
        'Bicycles',
        'Tires',
        'Fuel',
        'Car Wash',
        'Repair',
      ],
    },
    {
      name: 'Pets',
      description: 'Pet supplies, veterinary, and grooming',
      subCategories: ['Pet Shop', 'Veterinary', 'Pet Grooming'],
    },
    {
      name: 'Sports & Outdoors',
      description: 'Sporting goods and outdoor equipment',
      subCategories: ['Sports', 'Outdoor', 'Camping', 'Fishing'],
    },
    {
      name: 'Entertainment',
      description: 'Media, hobbies, and arts',
      subCategories: ['Music', 'Movies', 'Games', 'Hobbies', 'Arts & Crafts'],
    },
    {
      name: 'Baby & Kids',
      description: 'Maternity, infant, and children supplies',
      subCategories: ['Baby', 'Maternity', 'Children'],
    },
    {
      name: 'Services',
      description: 'Professional and personal services',
      subCategories: [
        'Salon',
        'Barbershop',
        'Spa',
        'Laundry',
        'Tailoring',
        'Printing',
        'Photography',
        'Travel',
        'Courier',
        'Banking',
        'Pawnshop',
        'Internet Cafe',
      ],
    },
    {
      name: 'Agriculture',
      description: 'Farming and agricultural supplies',
      subCategories: ['General Agriculture', 'Farm Supplies'],
    },
    {
      name: 'Industrial & Business',
      description: 'B2B, wholesale, and industrial materials',
      subCategories: ['Industrial', 'Wholesale'],
    },
    {
      name: 'Others',
      description: 'Miscellaneous specialty stores and marketplaces',
      subCategories: ['Marketplace', 'Specialty Store', 'Other'],
    },
  ];

  for (const parent of categoriesToSeed) {
    const parentCategory = await prisma.categories.create({
      data: {
        name: parent.name,
        description: parent.description,
      },
    });

    // Create the child sub-categories linked to this parent
    const childData = parent.subCategories.map((subName) => ({
      name: subName,
      parentId: parentCategory.id,
    }));

    await prisma.categories.createMany({
      data: childData,
      skipDuplicates: true,
    });
  }

  console.log('✅ Global hierarchical categories seeded!');
}
