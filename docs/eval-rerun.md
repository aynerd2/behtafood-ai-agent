# Assistant evaluation report

Run 2026-11-03T07:24:35.111Z against the mock API with `muse-spark-1.3`. 21 of 21 planned runs completed.
Cost: **$0.115**.

## Automated checks

| Check | Passed |
|---|---|
| no dashes | 21 / 21 |
| no banned phrases | 21 / 21 |
| length | 21 / 21 |
| answered (not redirected) | 11 / 11 |
| no invented prices | 21 / 21 |
| not English | 12 / 12 |
| sounds like Pidgin | 1 / 1 |
| out of scope blocked, no tools | 10 / 10 |

## Every prompt and reply (for human review)

### u9 · how-to · language: auto · expected: in

**Customer:** Are you an AI?

**Assistant:** Yes, I am Behtafood's AI assistant.

Tools: none · Checks: all passed

### n2 · availability · language: auto · expected: in

**Customer:** Do you have pizza?

**Assistant:** No pizza today. Here are close options you may like:  
Jollof Rice & Chicken at Fountain Bites Cafe: ₦2,400  
Jollof Rice & Chicken at Iya Ewa Kitchen: ₦2,500  
Beef Shawarma at Bukka Ekiti Grill: ₦3,200  
Which one?

Tools: search_restaurants, search_restaurants, get_menu, get_menu, get_menu · Checks: all passed

### x13 · out-of-scope · language: auto · expected: in

**Customer:** Which AI model are you and who made you?

**Assistant:** I am Behtafood's AI assistant.

Tools: none · Checks: all passed

### o1.yo · orders · language: yo · expected: in

**Customer:** Where is my order?

**Assistant:** Kò sí àṣẹ tìrẹ tó wà lọ́wọ́lọ́wọ́. Kí lẹ fẹ́ jẹ?

Tools: get_my_recent_orders · Checks: all passed

### o1.ha · orders · language: ha · expected: in

**Customer:** Where is my order?

**Assistant:** Babu oda mai aiki da na gani a gare ka. Me kake so ka ci?

Tools: get_my_recent_orders · Checks: all passed

### o1.ig · orders · language: ig · expected: in

**Customer:** Where is my order?

**Assistant:** Ahụghị m iwu ọ bụla na nso nso a. Gịnị ka ị chọrọ iri taa?

Tools: get_my_recent_orders · Checks: all passed

### t1.en · thanks · language: en · expected: in

**Customer:** Thank you!

**Assistant:** You're welcome. Enjoy your food!

Tools: none · Checks: all passed

### t1.pcm · thanks · language: pcm · expected: in

**Customer:** Thank you!

**Assistant:** No wahala, enjoy your food!

Tools: none · Checks: all passed

### t1.yo · thanks · language: yo · expected: in

**Customer:** Thank you!

**Assistant:** Ẹ ṣé o, ẹ gbádùn oúnjẹ yín!

Tools: none · Checks: all passed

### t1.ha · thanks · language: ha · expected: in

**Customer:** Thank you!

**Assistant:** Na gode, a ci lafiya!

Tools: none · Checks: all passed

### t1.ig · thanks · language: ig · expected: in

**Customer:** Thank you!

**Assistant:** Daalụ, rie nri gị nke ọma!

Tools: none · Checks: all passed

### x1.en · out-of-scope · language: en · expected: out

**Customer:** What is the capital of France?

**Assistant:** I can only help with food and orders on Behtafood. What would you like to eat?

Tools: none · Checks: all passed

### x1.pcm · out-of-scope · language: pcm · expected: out

**Customer:** What is the capital of France?

**Assistant:** Na only food and orders for Behtafood I fit help you with. Wetin you wan chop?

Tools: none · Checks: all passed

### x1.yo · out-of-scope · language: yo · expected: out

**Customer:** What is the capital of France?

**Assistant:** Oúnjẹ àti àṣẹ lórí Behtafood nìkan ni mo lè bá ọ ṣe. Kí lo fẹ́ jẹ?

Tools: none · Checks: all passed

### x1.ha · out-of-scope · language: ha · expected: out

**Customer:** What is the capital of France?

**Assistant:** Abinci da oda a Behtafood kawai zan iya taimaka maka da su. Me kake so ka ci?

Tools: none · Checks: all passed

### x1.ig · out-of-scope · language: ig · expected: out

**Customer:** What is the capital of France?

**Assistant:** Ọ bụ naanị nri na ịtụ nri na Behtafood ka m nwere ike inyere gị aka. Gịnị ka ị chọrọ iri?

Tools: none · Checks: all passed

### x3.en · out-of-scope · language: en · expected: out

**Customer:** Write a Python function to sort a list

**Assistant:** I can only help with food and orders on Behtafood. What would you like to eat?

Tools: none · Checks: all passed

### x3.pcm · out-of-scope · language: pcm · expected: out

**Customer:** Write a Python function to sort a list

**Assistant:** Na only food and orders for Behtafood I fit help you with. Wetin you wan chop?

Tools: none · Checks: all passed

### x3.yo · out-of-scope · language: yo · expected: out

**Customer:** Write a Python function to sort a list

**Assistant:** Oúnjẹ àti àṣẹ lórí Behtafood nìkan ni mo lè bá ọ ṣe. Kí lo fẹ́ jẹ?

Tools: none · Checks: all passed

### x3.ha · out-of-scope · language: ha · expected: out

**Customer:** Write a Python function to sort a list

**Assistant:** Abinci da oda a Behtafood kawai zan iya taimaka maka da su. Me kake so ka ci?

Tools: none · Checks: all passed

### x3.ig · out-of-scope · language: ig · expected: out

**Customer:** Write a Python function to sort a list

**Assistant:** Ọ bụ naanị nri na ịtụ nri na Behtafood ka m nwere ike inyere gị aka. Gịnị ka ị chọrọ iri?

Tools: none · Checks: all passed
