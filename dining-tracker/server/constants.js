const LOCATIONS = [
    {
        id: '59972586ee596fe55d2eef75',
        name: 'The Commons Dining Hall (South Campus)',
        slug: 'the-commons-dining-hall-south-campus',
        hall_group: 'Dining Halls (All-You-Care-To-Eat)'
    },
    {
        id: '587909deee596f31cedc179c',
        name: 'Sbisa Dining Hall (North Campus)',
        slug: 'sbisa-dining-hall-north-campus',
        hall_group: 'Dining Halls (All-You-Care-To-Eat)'
    },
    {
        id: '5878eb5cee596f847636f114',
        name: 'Duncan Dining Hall (South Campus/Quad)',
        slug: 'duncan-dining-hall-south-campus-quad',
        hall_group: 'Dining Halls (All-You-Care-To-Eat)'
    },
    {
        id: '5873c5f43191a200e44eba43',
        name: '1876 Burgers - Sbisa Complex',
        slug: '1876-burgers-sbisa-complex',
        hall_group: 'North Campus'
    },
    {
        id: '586d0bf1ee596f6e75049512',
        name: 'Chick-Fil-A - Sbisa Underground Food Court',
        slug: 'chick-fil-a-sbisa-underground-food-court',
        hall_group: 'North Campus'
    },
    {
        id: '5c9a291319e02b0c4cd18d87',
        name: "Copperhead Jack's - Sbisa Complex",
        slug: 'copperhead-jacks-sbisa-complex',
        hall_group: 'North Campus'
    },
    {
        id: '586e7f19ee596f4034e1f5d0',
        name: 'Einstein Bros. Bagels - Sbisa Complex',
        slug: 'einstein-bros-bagels-sbisa-complex',
        hall_group: 'North Campus'
    },
    {
        id: '5873c5f33191a200e44eba3c',
        name: 'Pizza @ Underground',
        slug: 'pizza-underground',
        hall_group: 'North Campus'
    },
    {
        id: '5873c5f33191a200e44eba41',
        name: 'Cabo Grill - MSC',
        slug: 'cabo-grill-msc',
        hall_group: 'Central Campus'
    },
    {
        id: '5f04e0800101560bba2e7ee1',
        name: 'Chick-Fil-A - MSC Food Court',
        slug: 'chick-fil-a-msc-food-court',
        hall_group: 'Central Campus'
    },
    {
        id: '586d0bf1ee596f6e75049513',
        name: 'Panda Express - MSC',
        slug: 'panda-express-msc',
        hall_group: 'Central Campus'
    },
    {
        id: '5873c5f43191a200e44eba45',
        name: "Rev's American Grill - MSC",
        slug: 'revs-american-grill-msc',
        hall_group: 'Central Campus'
    },
    {
        id: '5873c5f33191a200e44eba42',
        name: 'Shake Smart - MSC',
        slug: 'shake-smart-msc',
        hall_group: 'Central Campus'
    },
    {
        id: '586d0bf1ee596f6e75049511',
        name: 'Chick-fil-A - West Campus Food Hall',
        slug: 'chick-fil-a-west-campus-food-hall',
        hall_group: 'West Campus'
    },
    {
        id: '5ff34e653a585b113c081c17',
        name: 'Panda Express - Polo Garage',
        slug: 'panda-express-polo-garage',
        hall_group: 'East Campus'
    },
    {
        id: '5ff34f9a3a585b1145e16abd',
        name: 'Salata',
        slug: 'salata',
        hall_group: 'East Campus'
    }
];

const PERIODS = [
    { id: '69c728901eb93fe151791f30', name: 'Breakfast', slug: 'breakfast', startHour: 6, endHour: 10 },
    { id: '69c728901eb93fe151791f32', name: 'Brunch', slug: 'brunch', startHour: 10, endHour: 15 },
    { id: '69c728901eb93fe151791f31', name: 'Lunch', slug: 'lunch', startHour: 10, endHour: 15 },
    { id: '69c728901eb93fe151791f2f', name: 'Dinner', slug: 'dinner', startHour: 15, endHour: 22 }
];

module.exports = { LOCATIONS, PERIODS };
