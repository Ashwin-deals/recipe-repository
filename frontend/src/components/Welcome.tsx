import { useAuth } from "../hooks/useAuth";
import { useChat } from "../hooks/useChat";
import { ChefMark } from "./ChefMark";
import { Icon } from "./Icon";

/** First-run note after sign-up: the starter recipes are already here; try Snap-a-recipe and the chef. */
export function Welcome({ onSnap, recipeCount }: { onSnap: () => void; recipeCount: number }) {
  const { user, dismissWelcome } = useAuth();
  const { openChat } = useChat();
  if (!user) return null;
  const first = user.display_name.split(" ")[0];
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <span className="welcome-mark" aria-hidden="true">
        <ChefMark />
      </span>
      <div className="welcome-body">
        <p className="eyebrow">Your recipe box is ready</p>
        <h2 id="welcome-title">Welcome, {first}.</h2>
        <p>
          {recipeCount > 0
            ? `We put ${recipeCount} starter recipes in your box so you can try things straight away. They're yours to edit or delete.`
            : "Your box is empty and private to you. Add your first recipe to get going."}
        </p>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={onSnap}>
            <Icon name="camera" />
            Snap a recipe
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => openChat({ recipe: null })}>
            <Icon name="chat" />
            Ask the chef
          </button>
        </div>
      </div>
      <button type="button" className="btn-icon welcome-close" onClick={dismissWelcome} aria-label="Dismiss welcome">
        <Icon name="close" />
      </button>
    </section>
  );
}
