import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, getToken } from "./client.js";
import { getTheme, setTheme } from "../theme.js";

const AuthContext = createContext(null);

// Тема аккаунта важнее браузерной: если у пользователя сохранён выбор — применяем
// его (следует за пользователем между устройствами/адресами). Если ещё не задан —
// засеваем его текущим выбором из браузера, чтобы дальше он ездил с аккаунтом.
function syncTheme(user) {
  if (user?.theme === "light" || user?.theme === "dark") {
    setTheme(user.theme);
  } else if (user) {
    api.put("/api/auth/me/theme", { theme: getTheme() }).catch(() => {});
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get("/api/auth/me")
      .then((me) => { setUser(me); syncTheme(me); })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const data = await api.postForm("/api/auth/login", {
      username: email,
      password,
    });
    setToken(data.access_token);
    const me = await api.get("/api/auth/me");
    setUser(me);
    syncTheme(me);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
