/**
 * Supabase Realtime subscription manager — ChemCtrl
 *
 * Arquitetura:
 * - Um único cliente Supabase WebSocket compartilhado (singleton).
 * - Um único canal por tabela compartilhado entre componentes.
 * - Reconexão automática em falhas.
 * - Refresh automático ao recuperar conexão ou foco da aplicação.
 * - Normalização de payload incompleto do Realtime.
 */

import { createClient } from '@supabase/supabase-js';
import {
  supabaseUrl,
  supabaseAnonKey,
  entityTableMap
} from '@/api/supabaseClient';

import { getSessionId } from '@/api/rpcClient';


// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function safeExecute(callback) {
  try {
    callback();
  } catch (_) {}
}


// ─────────────────────────────────────────────
// Singleton Supabase Realtime Client
// ─────────────────────────────────────────────

let supabaseWS = null;

function getSupabase() {

  if (supabaseWS) {
    return supabaseWS;
  }

  const sessionId = getSessionId();

  supabaseWS = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      realtime: {
        params: {
          eventsPerSecond: 20
        },
        timeout: 30000
      },

      auth: {
        persistSession: false
      },

      global: {
        headers: sessionId
          ? {
              'x-session-id': sessionId
            }
          : {}
      }
    }
  );

  return supabaseWS;
}


// ─────────────────────────────────────────────
// Reset client (login/logout)
// ─────────────────────────────────────────────

export function resetRealtimeClient() {

  tableChannels.forEach(channel => {
    safeExecute(() => {
      supabaseWS?.removeChannel(channel);
    });
  });

  tableCallbacks.clear();
  tableChannels.clear();
  tableStatus.clear();

  reconnectTimers.forEach(timer => {
    clearTimeout(timer);
  });

  reconnectTimers.clear();

  supabaseWS = null;
}


// ─────────────────────────────────────────────
// Estados internos
// ─────────────────────────────────────────────

const tableCallbacks = new Map();
const tableChannels = new Map();
const tableStatus = new Map();
const reconnectTimers = new Map();

const RECONNECT_DELAY_MS = 2000;


// ─────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────

export function getRealtimeStatus(entityName) {

  const tableName = entityTableMap[entityName];

  return tableName
    ? (tableStatus.get(tableName) || 'disconnected')
    : 'disconnected';
}


export function isAllConnected() {

  if (tableStatus.size === 0) {
    return false;
  }

  for (const status of tableStatus.values()) {

    if (status !== 'connected') {
      return false;
    }

  }

  return true;
}


// ─────────────────────────────────────────────
// Payload handling
// ─────────────────────────────────────────────

function dispatchToCallbacks(tableName, payload) {

  const callbacks = tableCallbacks.get(tableName);

  if (!callbacks) {
    return;
  }

  callbacks.forEach(callback => {

    safeExecute(() => {
      callback(payload);
    });

  });
}



function normalizePayload(payload) {

  const {
    eventType,
    new: newRecord,
    old: oldRecord
  } = payload;


  if (
    eventType === 'INSERT' &&
    (!newRecord || Object.keys(newRecord).length <= 1)
  ) {

    return {
      eventType: 'REFRESH'
    };

  }


  if (
    eventType === 'UPDATE' &&
    (!newRecord || Object.keys(newRecord).length <= 1)
  ) {

    return {
      eventType: 'REFRESH'
    };

  }


  if (
    eventType === 'DELETE' &&
    (!oldRecord || !oldRecord.id)
  ) {

    return {
      eventType: 'REFRESH'
    };

  }


  return {
    eventType,
    new: newRecord,
    old: oldRecord
  };

}


// ─────────────────────────────────────────────
// Channel creation
// ─────────────────────────────────────────────

function createChannel(tableName) {

  const supabase = getSupabase();

  tableStatus.set(
    tableName,
    'connecting'
  );


  const channel = supabase
    .channel(`chemctrl-${tableName}`)

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: tableName
      },

      payload => {

        dispatchToCallbacks(
          tableName,
          normalizePayload(payload)
        );

      }

    )


    .subscribe((status)=>{


      if(status === 'SUBSCRIBED'){

        tableStatus.set(
          tableName,
          'connected'
        );


        const timer = reconnectTimers.get(tableName);

        if(timer){

          clearTimeout(timer);
          reconnectTimers.delete(tableName);

        }


        dispatchToCallbacks(
          tableName,
          {
            eventType:'REFRESH'
          }
        );

      }


      if(
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ){

        tableStatus.set(
          tableName,
          'error'
        );

        scheduleReconnect(tableName);

      }


    });


  tableChannels.set(
    tableName,
    channel
  );

}



// ─────────────────────────────────────────────
// Reconnect
// ─────────────────────────────────────────────

function scheduleReconnect(tableName){

  if(reconnectTimers.has(tableName)){
    return;
  }


  const timer = setTimeout(()=>{


    reconnectTimers.delete(tableName);


    const oldChannel =
      tableChannels.get(tableName);


    if(oldChannel){

      safeExecute(()=>{
        getSupabase()
          .removeChannel(oldChannel);
      });

    }


    tableChannels.delete(tableName);



    const subscribers =
      tableCallbacks.get(tableName);


    if(
      subscribers &&
      subscribers.size > 0
    ){

      createChannel(tableName);

    }


  }, RECONNECT_DELAY_MS);



  reconnectTimers.set(
    tableName,
    timer
  );

}


// ─────────────────────────────────────────────
// Visibility refresh
// ─────────────────────────────────────────────

if(typeof document !== 'undefined'){


  document.addEventListener(
    'visibilitychange',
    ()=>{


      if(document.visibilityState === 'visible'){


        tableStatus.forEach(
          (status, tableName)=>{


            if(
              status === 'error' ||
              status === 'disconnected'
            ){

              scheduleReconnect(tableName);

            }


            dispatchToCallbacks(
              tableName,
              {
                eventType:'REFRESH'
              }
            );


          }
        );

      }


    }
  );



  window.addEventListener(
    'focus',
    ()=>{


      tableStatus.forEach(
        (_,tableName)=>{


          dispatchToCallbacks(
            tableName,
            {
              eventType:'REFRESH'
            }
          );


        }
      );


    }
  );

}


// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export function subscribeToTable(
  entityName,
  callback
){

  const tableName =
    entityTableMap[entityName];


  if(!tableName){
    return ()=>{};
  }


  if(!tableCallbacks.has(tableName)){

    tableCallbacks.set(
      tableName,
      new Set()
    );

  }


  tableCallbacks
    .get(tableName)
    .add(callback);



  if(!tableChannels.has(tableName)){

    createChannel(tableName);

  }



  return ()=>{


    const callbacks =
      tableCallbacks.get(tableName);



    if(callbacks){

      callbacks.delete(callback);



      if(callbacks.size === 0){


        tableCallbacks.delete(tableName);



        const channel =
          tableChannels.get(tableName);



        if(channel){

          safeExecute(()=>{
            getSupabase()
              .removeChannel(channel);
          });

        }



        tableChannels.delete(tableName);
        tableStatus.delete(tableName);



        const timer =
          reconnectTimers.get(tableName);


        if(timer){

          clearTimeout(timer);
          reconnectTimers.delete(tableName);

        }


      }

    }


  };

}



export function subscribeAllTables(
  onChangeCallback
){

  const unsubscribers =
    Object.keys(entityTableMap)
      .map(entityName =>

        subscribeToTable(
          entityName,
          payload=>{

            if(onChangeCallback){

              onChangeCallback(
                entityName,
                payload
              );

            }

          }
        )

      );


  return ()=>{

    unsubscribers.forEach(
      unsubscribe=>unsubscribe()
    );

  };

}
