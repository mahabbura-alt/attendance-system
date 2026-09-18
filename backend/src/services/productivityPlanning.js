'use strict';

const FLEET_FORMULA_VERSION = 'fleet-heterogeneous-v1';
const HAULER_FORMULA_VERSION = 'hauler-distance-matrix-v1';
const FLEET_DATABASE_FORMULA_VERSION = 'fleet-hauler-database-v2';
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const capacityKind = value => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'bcm') return 'bcm';
  if (normalized === 'ton') return 'ton';
  return null;
};

function calculateHeterogeneousFleet({ planningType, scenario, parameter, loader, trucks }) {
  const coal = planningType === 'coal';
  const bucketCapacity = finite(loader?.capacity);
  const fill = finite(parameter?.fill);
  const swell = finite(parameter?.swell);
  const density = coal ? finite(parameter?.density) : 1;
  const loaderCap = swell > 0 ? bucketCapacity * fill / swell : 0;
  const loadCycleSeconds = finite(scenario?.cycleTimeLoading);
  const validOperations = loadCycleSeconds > 0 && finite(scenario?.workEffLoader) > 0 && finite(scenario?.workEffLoader) <= 1
    && finite(scenario?.workEffFleet) > 0 && finite(scenario?.workEffFleet) <= 1
    && finite(scenario?.loadedSpeed) > 0 && finite(scenario?.emptySpeed) > 0
    && finite(scenario?.distance) > 0 && finite(scenario?.spotDumpTime) >= 0;
  const loaderProductivity = validOperations && loaderCap > 0 && density > 0
    ? (3600 / loadCycleSeconds) * loaderCap * finite(scenario?.workEffLoader) * density : 0;
  const truckResults = (trucks || []).map(truck => {
    const capacity = finite(truck.capacity);
    const kind = capacityKind(truck.capacityUom);
    const volumeCapacity = coal && kind === 'ton' && density > 0 ? capacity / density : kind === 'bcm' ? capacity : 0;
    const effectiveCapacity = coal ? (kind === 'ton' ? capacity : kind === 'bcm' ? capacity * density : 0)
      : (kind === 'bcm' ? capacity : 0);
    const passes = loaderCap > 0 && volumeCapacity > 0 ? Math.max(1, Math.round(volumeCapacity / loaderCap)) : 0;
    const loadingTime = passes * loadCycleSeconds / 60;
    const loadedTravel = finite(scenario.loadedSpeed) > 0 ? finite(scenario.distance) / finite(scenario.loadedSpeed) * 60 : 0;
    const emptyTravel = finite(scenario.emptySpeed) > 0 ? finite(scenario.distance) / finite(scenario.emptySpeed) * 60 : 0;
    const cycleTime = loadingTime + loadedTravel + emptyTravel + finite(scenario.spotDumpTime);
    const productivity = validOperations && cycleTime > 0 && effectiveCapacity > 0
      ? (60 / cycleTime) * effectiveCapacity * finite(scenario.workEffFleet) : 0;
    return { id: truck.id, capacity, effectiveCapacity, passes, loadingTime, cycleTime, productivity };
  });
  const truckFleetProductivity = truckResults.reduce((sum, truck) => sum + truck.productivity, 0);
  return {
    bucketCapacity, fill, swell, density, loaderCap, loaderProductivity, truckResults,
    truckFleetProductivity,
    fleetMatch: loaderProductivity > 0 ? truckFleetProductivity / loaderProductivity : 0,
    fleetProductivity: Math.min(loaderProductivity, truckFleetProductivity),
    complete: Boolean(scenario.jobCode && loaderCap > 0 && loaderProductivity > 0 && truckResults.length
      && (trucks || []).every(truck => truck.active !== false)
      && truckResults.every(truck => truck.productivity > 0)),
    formulaVersion: FLEET_FORMULA_VERSION,
    productivityUnit: coal ? 'Ton/Hr' : 'BCM/Hr'
  };
}

function calculateHaulerProductivity({ planningType, distanceMeters, truck, parameter, profile }) {
  const coal = planningType === 'coal';
  const capacity = finite(truck?.capacity);
  const density = coal ? finite(parameter?.density) : 1;
  const kind = capacityKind(truck?.capacityUom);
  const loadedSpeed = finite(profile?.loadedSpeed);
  const emptySpeed = finite(profile?.emptySpeed);
  const efficiency = finite(profile?.workEfficiency);
  if (!(capacity > 0) || !(loadedSpeed > 0) || !(emptySpeed > 0) || !(efficiency > 0 && efficiency <= 1)
    || profile?.loadingTime == null || String(profile.loadingTime).trim() === ''
    || profile?.spotDumpTime == null || String(profile.spotDumpTime).trim() === ''
    || finite(profile?.loadingTime) < 0 || finite(profile?.spotDumpTime) < 0
    || (coal && !(density > 0)) || !kind || (!coal && kind !== 'bcm')) return null;
  const effectiveCapacity = coal && kind === 'bcm' ? capacity * density : capacity;
  const distanceKm = finite(distanceMeters) / 1000;
  const cycleTime = finite(profile.loadingTime) + distanceKm / loadedSpeed * 60
    + distanceKm / emptySpeed * 60 + finite(profile.spotDumpTime);
  if (!(cycleTime > 0)) return null;
  return {
    productivity: (60 / cycleTime) * effectiveCapacity * efficiency,
    cycleTime, effectiveCapacity,
    productivityUnit: coal ? 'Ton/Hr' : 'BCM/Hr',
    formulaVersion: HAULER_FORMULA_VERSION
  };
}

function calculateFleetFromHaulerRows({ planningType, scenario, parameter, loader, trucks, haulerRows }) {
  const coal = planningType === 'coal';
  const bucketCapacity = finite(loader?.capacity);
  const fill = finite(parameter?.fill);
  const swell = finite(parameter?.swell);
  const density = coal ? finite(parameter?.density) : 1;
  const loaderCap = swell > 0 ? bucketCapacity * fill / swell : 0;
  const cycleSeconds = finite(scenario?.cycleTimeLoading);
  const loaderEfficiency = finite(scenario?.workEffLoader);
  const loaderProductivity = cycleSeconds > 0 && loaderCap > 0 && density > 0
    && loaderEfficiency > 0 && loaderEfficiency <= 1
    ? (3600 / cycleSeconds) * loaderCap * loaderEfficiency * density : 0;
  const rowByTruck = new Map((haulerRows || []).map(row => [String(row.truckId), row]));
  const distanceMeters = finite(scenario?.benchmarkDistanceMeters);
  const truckResults = (trucks || []).map(truck => {
    const row = rowByTruck.get(String(truck.id));
    const capacity = finite(row?.capacity);
    const kind = capacityKind(row?.capacityUom);
    const volumeCapacity = coal && kind === 'ton' && density > 0 ? capacity / density
      : kind === 'bcm' ? capacity : 0;
    const passes = loaderCap > 0 && volumeCapacity > 0 ? Math.max(1, Math.round(volumeCapacity / loaderCap)) : 0;
    const loadingTime = passes && cycleSeconds > 0 ? passes * cycleSeconds / 60 : null;
    const calculated = loadingTime !== null && distanceMeters > 0
      ? calculateHaulerProductivity({ planningType, distanceMeters,
        truck: { capacity, capacityUom: kind }, parameter,
        profile: { ...row, loadingTime } }) : null;
    return { id: truck.id, capacity, capacityUom: kind, passes, loadingTime,
      cycleTime: calculated?.cycleTime ?? null, productivity: calculated?.productivity ?? null };
  });
  const truckFleetProductivity = truckResults.reduce((sum, row) => sum + (row.productivity || 0), 0);
  const complete = Boolean(scenario?.jobCode && loaderProductivity > 0 && distanceMeters > 0
    && truckResults.length && (trucks || []).every(truck => truck.active !== false)
    && truckResults.every(row => row.productivity > 0));
  return { bucketCapacity, fill, swell, density, loaderCap, loaderProductivity,
    truckFleetProductivity, truckResults, fleetMatch: loaderProductivity > 0
      ? truckFleetProductivity / loaderProductivity : 0,
    fleetProductivity: complete ? Math.min(loaderProductivity, truckFleetProductivity) : 0,
    complete, formulaVersion: FLEET_DATABASE_FORMULA_VERSION,
    productivityUnit: coal ? 'Ton/Hr' : 'BCM/Hr' };
}

function calculateLoaderProductivity({ planningType, scenario, parameter, loader }) {
  const bucketCapacity = finite(loader?.capacity);
  const fill = finite(parameter?.fill);
  const swell = finite(parameter?.swell);
  const density = planningType === 'coal' ? finite(parameter?.density) : 1;
  const loaderCap = swell > 0 ? bucketCapacity * fill / swell : 0;
  const cycleSeconds = finite(scenario?.cycleTimeLoading);
  const efficiency = finite(scenario?.workEffLoader);
  const loaderProductivity = loaderCap > 0 && density > 0 && cycleSeconds > 0
    && efficiency > 0 && efficiency <= 1
    ? 3600 / cycleSeconds * loaderCap * efficiency * density : 0;
  return { bucketCapacity, fill, swell, density, loaderCap, loaderProductivity,
    complete: loaderProductivity > 0, productivityUnit: planningType === 'coal' ? 'Ton/Hr' : 'BCM/Hr' };
}

module.exports = { FLEET_FORMULA_VERSION, HAULER_FORMULA_VERSION, FLEET_DATABASE_FORMULA_VERSION,
  calculateHeterogeneousFleet, calculateHaulerProductivity, calculateFleetFromHaulerRows,
  calculateLoaderProductivity };
