export type CategoryFilter = 'all' | 'restaurants' | 'boucheries' | 'others'

const normalizeCategory = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

const isRestaurantCategory = (categories: string[]) =>
  categories.some((category) => {
    const normalized = normalizeCategory(category)
    return normalized.includes('restaurant') || normalized.includes('resto')
  })

const isBoucherieCategory = (categories: string[]) =>
  categories.some((category) => {
    const normalized = normalizeCategory(category)
    return normalized.includes('boucher')
  })

export const matchesCategoryFilter = (
  establishment: { categories?: string[] },
  filter: CategoryFilter,
) => {
  if (filter === 'all') return true
  const categories = Array.isArray(establishment?.categories)
    ? establishment.categories.filter(Boolean)
    : []
  if (categories.length === 0) {
    return filter === 'others'
  }

  const restaurant = isRestaurantCategory(categories)
  const boucherie = isBoucherieCategory(categories)

  if (filter === 'restaurants') return restaurant
  if (filter === 'boucheries') return boucherie
  return !restaurant && !boucherie
}
