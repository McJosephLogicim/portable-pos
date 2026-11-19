import type { Product } from "./types";

export const demoMenu: Product[] = [
  {
    id: "cd3dc117-a1c3-536b-be26-009d8d804f88",
    name: "Caffè Latte",
    category: "Coffee",
    price: 16000,
    image: "/menu/caffe-latte.webp",
    groups: [
      {
        id: "d45db88e-d72b-51fd-b8ac-ce96733b45b4",
        name: "Milk",
        required: true,
        options: [
          {
            id: "ba35b06e-3f3a-5bc0-b884-852d88c6b5fd",
            name: "Whole milk",
            price: 0,
          },
          {
            id: "c4bf9adb-21d6-5c6b-90d5-b98e5ca22011",
            name: "Oat milk",
            price: 3000,
          },
        ],
      },
    ],
  },
  {
    id: "3931b833-6c55-5a5a-a1c1-12acc384865c",
    name: "Butter Croissant",
    category: "Bakery",
    price: 12000,
    image: "/menu/butter-croissant.webp",
    groups: [],
    stock: true,
  },
  {
    id: "60e817b8-6fc4-5c17-931e-76285d156e47",
    name: "Iced Latte",
    category: "Cold drinks",
    price: 17000,
    image: "/menu/iced-latte.webp",
    groups: [
      {
        id: "b99eb0de-4019-5ad0-baa9-c323c6443b75",
        name: "Milk",
        required: true,
        options: [
          {
            id: "e1f61cda-aa4b-523a-bff0-c49d3cf013b0",
            name: "Whole milk",
            price: 0,
          },
          {
            id: "25227c3c-68ad-5965-9973-16ce9c10d3e3",
            name: "Oat milk",
            price: 3000,
          },
        ],
      },
    ],
  },
  {
    id: "b36083df-9bc5-5fc5-aa06-4e3682f15856",
    name: "Cappuccino",
    category: "Coffee",
    price: 15000,
    image: "/menu/cappuccino.webp",
    groups: [
      {
        id: "446f23d1-179b-5649-9a84-8430ce1b13e5",
        name: "Milk",
        required: true,
        options: [
          {
            id: "a01b0e19-7007-548c-b850-97259cf8ddb2",
            name: "Whole milk",
            price: 0,
          },
          {
            id: "ea2e95c8-5823-5fe1-8722-0c904c579351",
            name: "Oat milk",
            price: 3000,
          },
        ],
      },
    ],
  },
  {
    id: "53435ac0-aae0-5f64-b506-42f177bad2a5",
    name: "Cinnamon Roll",
    category: "Bakery",
    price: 12500,
    image: "/menu/cinnamon-roll.webp",
    groups: [],
    stock: true,
  },
  {
    id: "91d842b3-f2fb-5bb6-bb7a-613ff9152fab",
    name: "Cold Brew",
    category: "Cold drinks",
    price: 16000,
    image: "/menu/cold-brew.webp",
    groups: [],
  },
  {
    id: "976ec768-d79b-573a-946a-c05173194b30",
    name: "Espresso",
    category: "Coffee",
    price: 11000,
    image: "/menu/espresso.webp",
    groups: [],
  },
  {
    id: "35e31b1d-2d82-57ec-9955-121c787789c9",
    name: "Chocolate Chunk Cookie",
    category: "Bakery",
    price: 9500,
    image: "/menu/chocolate-chunk-cookie.webp",
    groups: [],
    stock: true,
  },
  {
    id: "50bdf8f1-b035-5ae0-9744-62bca9cd7778",
    name: "Mint Lemonade",
    category: "Cold drinks",
    price: 13000,
    image: "/menu/mint-lemonade.webp",
    groups: [],
  },
];
