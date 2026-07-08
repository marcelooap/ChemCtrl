/**
 * ChemCtrl - Tanka stock management
 *
 * Remove volumes/massas de uma tanka quando ela recebe
 * um vasilhame do tipo Tankagem.
 *
 * Base44 removido.
 * Usa Supabase diretamente.
 */

import { supabase } from '@/lib/supabaseClient';


const parseArr = (v) => {

  if (!v) return [];

  if (Array.isArray(v)) {
    return v;
  }

  try {

    const parsed =
      typeof v === 'string'
        ? JSON.parse(v)
        : v;

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch {

    return [];

  }

};


/**
 * Zera entradas de tanque no estoque de matéria-prima.
 *
 * @param {string} tankaName
 */
export async function zeroOutTankaStock(tankaName) {

  if (!tankaName) {
    return;
  }


  const {
    data: stockEntries,
    error: fetchError
  } = await supabase
    .from('raw_material_stock')
    .select('*')
    .order('created_date', {
      ascending: false
    })
    .limit(500);



  if (fetchError) {

    console.error(
      'Erro ao buscar estoque:',
      fetchError
    );

    throw fetchError;

  }



  for (const stock of stockEntries || []) {


    const entries =
      parseArr(stock.tank_entries);



    let modified = false;



    const updated =
      entries.map(te => {


        if (
          te.tank_name === tankaName &&
          (
            Number(te.volume) > 0 ||
            Number(te.mass) > 0
          )
        ){

          modified = true;


          return {
            ...te,
            volume: 0,
            mass: 0
          };

        }


        return te;

      });



    if(modified){


      const {
        error:updateError
      } = await supabase
        .from('raw_material_stock')
        .update({
          tank_entries: updated
        })
        .eq(
          'id',
          stock.id
        );



      if(updateError){

        console.error(
          'Erro ao atualizar estoque:',
          updateError
        );

        throw updateError;

      }

    }

  }

}
