# Pass Around Plates

The family recipe collection, rebuilt from [passaroundplates.blogspot.com](https://passaroundplates.blogspot.com/) as a static website for GitHub Pages.

- 190 recipes with cleaned-up measurements (tsp, Tbsp, cup/cups, oz, lb, °F) and rewritten instructions. No ingredient amounts were changed.
- Search by name, ingredient, or anything else in the recipe.
- Filter by category (Dinner, Chicken, Dessert, Breakfast, Side Dishes, and more) and by who the recipe is from.
- Print or save any recipe as a PDF.
- A link from every recipe back to its original blog post.
- Family members with an access token can add, edit, and delete recipes right on the site.

## Put it on GitHub Pages

1. Create a new repository on GitHub, for example `family-recipes`. It can be public or private (private Pages sites need a paid GitHub plan).
2. Push this folder to it:
   ```sh
   git remote add origin https://github.com/<you>/family-recipes.git
   git push -u origin main
   ```
3. In the repository, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch **main**, folder **/docs**, and save.
4. After a minute the site is live at `https://<you>.github.io/family-recipes/`.

The site figures out its own repository from that address. If you use a custom domain instead, fill in `owner` and `repo` in `docs/config.js`.

## Let family members add recipes

Saving a recipe makes a commit to this repository, so the site needs a GitHub access token with permission to write to it. The token is the "password": without one, the add and edit pages can't save anything.

**To make a token:**
1. On GitHub go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it, for example "Recipe site – Mom", and pick an expiration.
3. Under **Repository access**, choose **Only select repositories** and pick the recipe repository.
4. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**. Leave everything else as is.
5. Generate it and copy the `github_pat_…` value.

On the site, click **Add recipe**, paste the token, and click **Connect**. Leave "Remember on this device" checked to stay signed in on that phone or computer.

**Who gets a token?** The simplest option is for the repository owner to create one token per family member (named so you can tell them apart) and send each person their own. To cut someone off, delete their token on GitHub. If family members have their own GitHub accounts, you can instead add them as collaborators on the repository and have each make their own token.

New recipes show up immediately on the device that saved them, and for everyone else after GitHub Pages redeploys (usually a minute or two).

## Files

- `docs/`: the website that GitHub Pages serves
  - `data/recipes.json`: all recipes (the site edits this file when you save)
  - `images/`: recipe photos
  - `assets/app.js`, `assets/styles.css`, `index.html`: the site itself
  - `config.js`: site title and repository settings
- `tools/`: the scripts used for the one-time import from the blog (`scrape.py`, `build.py`, `units.py`). You don't need them to run the site.

The site has no build step: edit the files, push, and Pages publishes them. To preview locally, run `python3 -m http.server -d docs` and open http://localhost:8000.
