const isNode = typeof window === "undefined";

const storage = isNode
  ? {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  : window.localStorage;

const toSnakeCase = (str) => {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
};

const getAppParamValue = (
  paramName,
  {
    defaultValue = undefined,
    removeFromUrl = false,
    storagePrefix = "app"
  } = {}
) => {
  if (isNode) {
    return defaultValue;
  }

  const storageKey = `${storagePrefix}_${toSnakeCase(paramName)}`;

  const urlParams = new URLSearchParams(window.location.search);
  const searchParam = urlParams.get(paramName);

  if (removeFromUrl) {
    urlParams.delete(paramName);

    const newUrl =
      `${window.location.pathname}` +
      `${urlParams.toString() ? `?${urlParams.toString()}` : ""}` +
      `${window.location.hash}`;

    window.history.replaceState({}, document.title, newUrl);
  }

  if (searchParam !== null) {
    storage.setItem(storageKey, searchParam);
    return searchParam;
  }

  if (defaultValue !== undefined) {
    storage.setItem(storageKey, defaultValue);
    return defaultValue;
  }

  const storedValue = storage.getItem(storageKey);

  return storedValue ?? null;
};

const getAppParams = () => {
  if (getAppParamValue("clear_access_token") === "true") {
    storage.removeItem("app_access_token");
    storage.removeItem("token");
  }

  return {
    appId: getAppParamValue("app_id", {
      defaultValue: import.meta.env.VITE_APP_ID
    }),

    token: getAppParamValue("access_token", {
      removeFromUrl: true
    }),

    fromUrl: getAppParamValue("from_url", {
      defaultValue: window.location.href
    }),

    apiUrl: getAppParamValue("api_url", {
      defaultValue: import.meta.env.VITE_API_URL
    }),

    appVersion: getAppParamValue("app_version", {
      defaultValue: import.meta.env.VITE_APP_VERSION || "1.0.0"
    })
  };
};

export const appParams = {
  ...getAppParams()
};
