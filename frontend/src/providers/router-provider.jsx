// Связывает ссылки react-aria (Link, MenuItem с href и т.п.) с react-router:
// переход происходит внутри приложения, а не перезагрузкой страницы.
import { RouterProvider } from "react-aria-components";
import { useHref, useNavigate } from "react-router-dom";

export function RouteProvider({ children }) {
  const navigate = useNavigate();
  return (
    <RouterProvider navigate={navigate} useHref={useHref}>
      {children}
    </RouterProvider>
  );
}
