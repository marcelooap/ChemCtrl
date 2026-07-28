// Ponto único de descoberta dos clientes Supabase da plataforma ChemCtrl.
// Cada módulo tem seu próprio projeto Supabase e cliente isolado.
//
// ChemFlow NÃO é re-exportado aqui de propósito: o módulo `chemflow.js` valida
// variáveis de ambiente na carga e não deve ser avaliados no bootstrap da
// plataforma / ChemBlend. Importe diretamente:
//   import { chemflowSupabase } from '@/services/supabase/chemflow'
export * from './chemblend';
