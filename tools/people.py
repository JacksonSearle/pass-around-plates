"""Who a recipe is from: family-member labels on the post, else the posting author."""
PEOPLE = {
    "Mom": "Mom", "Dad": "Dad", "Julie": "Julie", "Brittany": "Brittany", "Whitney": "Whitney",
    "McKenzie": "McKenzie", "Slade": "Slade", "BlakeandKindra": "Blake & Kindra", "Kindra": "Blake & Kindra",
    "Ashley": "Ashley", "Doug": "Doug", "Michelle": "Michelle", "Natel Thackeray": "NaTel Thackeray",
}
AUTHORS = {"Julie": "Julie", "Brittany": "Brittany", "Kindra": "Blake & Kindra", "BlakeryBob03": "Blake & Kindra",
           "Candi": "Candi", "Ashley Lyons": "Ashley", "Jeanne": "Mom"}

def default_from(post):
    names = []
    for label in post["labels"]:
        if label in PEOPLE and PEOPLE[label] not in names:
            names.append(PEOPLE[label])
    if not names and post["author"] in AUTHORS:
        names.append(AUTHORS[post["author"]])
    return names
