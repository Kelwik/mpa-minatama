const cache = {
  lobsterTypes: null,
  weightClasses: null,
};

export async function getLobsterTypes(supabase) {
  if (cache.lobsterTypes) return cache.lobsterTypes;
  const { data, error } = await supabase
    .from('lobster_types')
    .select('id, name')
    .order('name');
  if (error) throw error;
  cache.lobsterTypes = data || [];
  return cache.lobsterTypes;
}

export async function getWeightClasses(supabase) {
  if (cache.weightClasses) return cache.weightClasses;
  const { data, error } = await supabase
    .from('weight_classes')
    .select('id, weight_range')
    .order('weight_range');
  if (error) throw error;
  cache.weightClasses = data || [];
  return cache.weightClasses;
}

export function clearCache() {
  cache.lobsterTypes = null;
  cache.weightClasses = null;
}
