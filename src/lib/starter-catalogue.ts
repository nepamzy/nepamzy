/**
 * Popular Nigerian dishes and drinks a shop owner can start from when adding an item: the name, a short description and a photo
 * are filled in and can be changed; the owner always sets the price. Photos live in public/catalogue/<slug>.jpg.
 */
export type StarterItem = {
  slug: string
  name: string
  description: string
  section: 'Mains' | 'Soups and swallows' | 'Snacks' | 'Sides' | 'Drinks'
  /** true once public/catalogue/<slug>.jpg exists */
  photo?: true
}

export const STARTER_ITEMS: StarterItem[] = [
  {
    slug: 'jollof-rice-chicken',
    photo: true,
    name: 'Jollof rice and chicken',
    description: 'Smoky party-style jollof with a piece of chicken.',
    section: 'Mains',
  },
  {
    slug: 'fried-rice-chicken',
    photo: true,
    name: 'Fried rice and chicken',
    description: 'Fried rice with vegetables and chicken.',
    section: 'Mains',
  },
  {
    slug: 'white-rice-stew',
    photo: true,
    name: 'White rice and stew',
    description: 'Steamed white rice with tomato stew.',
    section: 'Mains',
  },
  {
    slug: 'jollof-spaghetti',
    photo: true,
    name: 'Jollof spaghetti',
    description: 'Spaghetti cooked in jollof sauce.',
    section: 'Mains',
  },
  {
    slug: 'ofada-rice',
    photo: true,
    name: 'Ofada rice and sauce',
    description: 'Local ofada rice with ayamase pepper sauce.',
    section: 'Mains',
  },
  {
    slug: 'beans-plantain',
    photo: true,
    name: 'Beans and plantain',
    description: 'Stewed beans with fried plantain.',
    section: 'Mains',
  },
  {
    slug: 'yam-egg-sauce',
    name: 'Yam and egg sauce',
    description: 'Boiled yam with fried egg sauce.',
    section: 'Mains',
  },
  {
    slug: 'fried-yam-pepper-sauce',
    name: 'Fried yam and pepper sauce',
    description: 'Golden fried yam with pepper sauce.',
    section: 'Mains',
  },
  {
    slug: 'egusi-pounded-yam',
    name: 'Egusi soup and pounded yam',
    description: 'Melon-seed soup with pounded yam.',
    section: 'Soups and swallows',
  },
  {
    slug: 'amala-ewedu-gbegiri',
    name: 'Amala, ewedu and gbegiri',
    description: 'Amala with ewedu and gbegiri soups.',
    section: 'Soups and swallows',
  },
  {
    slug: 'eba-okra-soup',
    name: 'Eba and okra soup',
    description: 'Eba with okra soup and assorted meat.',
    section: 'Soups and swallows',
  },
  {
    slug: 'efo-riro-pounded-yam',
    name: 'Efo riro and pounded yam',
    description: 'Rich vegetable soup with pounded yam.',
    section: 'Soups and swallows',
  },
  {
    slug: 'pepper-soup',
    name: 'Goat meat pepper soup',
    description: 'Hot and spicy goat meat pepper soup.',
    section: 'Soups and swallows',
  },
  {
    slug: 'moi-moi',
    name: 'Moi moi',
    description: 'Steamed bean pudding.',
    section: 'Sides',
    photo: true,
  },
  {
    slug: 'fried-plantain',
    name: 'Fried plantain (dodo)',
    description: 'A generous portion of fried ripe plantain.',
    section: 'Sides',
  },
  { slug: 'akara', name: 'Akara', description: 'Fried bean cakes.', section: 'Snacks' },
  {
    slug: 'suya',
    name: 'Suya',
    description: 'Spicy grilled beef skewers with onions and yaji.',
    section: 'Snacks',
  },
  {
    slug: 'meat-pie',
    name: 'Meat pie',
    description: 'Flaky pastry filled with minced meat.',
    section: 'Snacks',
  },
  {
    slug: 'puff-puff',
    name: 'Puff puff',
    description: 'Soft, sweet fried dough balls.',
    section: 'Snacks',
  },
  {
    slug: 'chin-chin',
    name: 'Chin chin',
    description: 'Crunchy sweet fried snack.',
    section: 'Snacks',
  },
  {
    slug: 'shawarma',
    name: 'Shawarma',
    description: 'Chicken shawarma wrap with sauce.',
    section: 'Snacks',
  },
  { slug: 'zobo', name: 'Zobo drink', description: 'Chilled hibiscus drink.', section: 'Drinks' },
  {
    slug: 'chapman',
    name: 'Chapman',
    description: 'Fruity Nigerian cocktail drink, no alcohol.',
    section: 'Drinks',
  },
  { slug: 'kunu', name: 'Kunu', description: 'Chilled millet drink.', section: 'Drinks' },
  {
    slug: 'tigernut-drink',
    name: 'Tigernut drink (kunu aya)',
    description: 'Sweet creamy tigernut drink.',
    section: 'Drinks',
  },
  {
    slug: 'bottled-water',
    name: 'Bottled water',
    description: 'Cold bottled water.',
    section: 'Drinks',
  },
  {
    slug: 'soft-drink',
    name: 'Soft drink',
    description: 'Chilled bottled soft drink.',
    section: 'Drinks',
  },
  {
    slug: 'fresh-juice',
    name: 'Fresh fruit juice',
    description: 'Freshly squeezed orange juice.',
    section: 'Drinks',
  },
]

export const starterPhotoUrl = (i: StarterItem) => `/catalogue/${i.slug}.jpg`
