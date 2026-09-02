const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://sjoytwcrdewealudjxep.supabase.co';
const supabaseKey = 'sb_publishable_ntEGkpHa7MVUq-nDw9fp-w_fAtOztkF';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDB() {
  console.log('=== VERIFICANDO ESQUEMA DE BASE DE DATOS ===\n');

  // 1. Verificar columnas en profiles
  console.log('1. Tabla profiles - columnas de dirección guardada:');
  const { data: profilesCols, error: profilesErr } = await supabase
    .from('profiles')
    .select('saved_address, saved_lat, saved_lng')
    .limit(1);
  if (profilesErr) {
    console.log('   ERROR:', profilesErr.message);
  } else {
    console.log('   OK - Columnas existen');
  }

  // 2. Verificar columna customer_rating en orders
  console.log('\n2. Tabla orders - columna customer_rating:');
  const { data: ordersCols, error: ordersErr } = await supabase
    .from('orders')
    .select('customer_rating, estimated_ready_at')
    .limit(1);
  if (ordersErr) {
    console.log('   ERROR:', ordersErr.message);
  } else {
    console.log('   OK - Columnas existen');
  }

  // 3. Verificar app_settings
  console.log('\n3. Tabla app_settings - claves necesarias:');
  const { data: settings, error: settingsErr } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['store_open', 'store_delay_minutes', 'store_delay_message']);
  if (settingsErr) {
    console.log('   ERROR:', settingsErr.message);
  } else {
    console.log('   Claves encontradas:', settings.map(s => s.key).join(', ') || 'NINGUNA');
  }

  // 4. Verificar funciones RPC
  console.log('\n4. Verificando funciones RPC:');
  
  const functions = [
    'get_store_status',
    'rate_order',
    'get_order_status',
    'set_estimated_ready_at',
    'confirm_order_received',
    'cleanup_old_orders',
    'get_order_rider_info',
    'get_user_role',
    'send_flash_email',
    'create_order'
  ];

  for (const fn of functions) {
    try {
      // Intentar llamar con parámetros dummy para ver si existe
      let result;
      if (fn === 'get_store_status') {
        result = await supabase.rpc(fn);
      } else if (fn === 'get_user_role') {
        result = await supabase.rpc(fn);
      } else if (fn === 'create_order') {
        result = await supabase.rpc(fn, { p_delivery_address: 'test', p_total: 0, p_items: [] });
      } else if (fn === 'get_order_status') {
        result = await supabase.rpc(fn, { order_id: '00000000-0000-0000-0000-000000000000' });
      } else if (fn === 'rate_order') {
        result = await supabase.rpc(fn, { p_order_id: '00000000-0000-0000-0000-000000000000', p_rating: 5 });
      } else if (fn === 'set_estimated_ready_at') {
        result = await supabase.rpc(fn, { p_order_id: '00000000-0000-0000-0000-000000000000' });
      } else if (fn === 'confirm_order_received') {
        result = await supabase.rpc(fn, { p_order_id: '00000000-0000-0000-0000-000000000000' });
      } else if (fn === 'cleanup_old_orders') {
        result = await supabase.rpc(fn, { p_user_id: '00000000-0000-0000-0000-000000000000', p_keep: 10 });
      } else if (fn === 'get_order_rider_info') {
        result = await supabase.rpc(fn, { p_order_id: '00000000-0000-0000-0000-000000000000' });
      } else if (fn === 'send_flash_email') {
        result = await supabase.rpc(fn, { p_offer_id: '00000000-0000-0000-0000-000000000000' });
      }
      
      if (result.error && result.error.code === 'PGRST202') {
        console.log(`   ${fn}: EXISTE (error de parámetros esperado)`);
      } else if (result.error && result.error.message.includes('function') && result.error.message.includes('does not exist')) {
        console.log(`   ${fn}: FALTA - ${result.error.message}`);
      } else {
        console.log(`   ${fn}: EXISTE`);
      }
    } catch (e) {
      console.log(`   ${fn}: ERROR - ${e.message}`);
    }
  }

  // 5. Verificar tabla riders
  console.log('\n5. Tabla riders - columnas rating y total_deliveries:');
  const { data: ridersCols, error: ridersErr } = await supabase
    .from('riders')
    .select('rating, total_deliveries')
    .limit(1);
  if (ridersErr) {
    console.log('   ERROR:', ridersErr.message);
  } else {
    console.log('   OK - Columnas existen');
  }

  // 6. Verificar tabla flash_offers
  console.log('\n6. Tabla flash_offers:');
  const { data: offersCols, error: offersErr } = await supabase
    .from('flash_offers')
    .select('id, product_id, discount_percentage, ends_at, is_active')
    .limit(1);
  if (offersErr) {
    console.log('   ERROR:', offersErr.message);
  } else {
    console.log('   OK - Tabla existe');
  }

  console.log('\n=== FIN DE VERIFICACIÓN ===');
}

checkDB();