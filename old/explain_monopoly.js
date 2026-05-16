window.lecture = [
    {
      "type": "defaults",
      "font_size_px": 22,
      "layout_split": 40,
      "draw_location": "right",
      "execution_mode": "movie",
      "movie_wait_seconds": 2
    },
      {
        "type": "new_page",
        "title": "The Efficient Benchmark"
      },
      {
        "type": "write",
        "markdown": "## Perfect Competition\n\n* **The Ideal Scenario**\n* Supply meets Demand freely",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "To understand Deadweight Loss, we first need to see what an \"efficient\" market looks like. This is our baseline: Perfect Competition."
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 10,
        "y1": 10,
        "x2": 10,
        "y2": 90,
        "stroke": "#333",
        "label": "Price",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 10,
        "y1": 10,
        "x2": 90,
        "y2": 10,
        "stroke": "#333",
        "label": "Quantity",
        "coords": "cartesian"
      },
      {
        "type": "speak",
        "text": "Here is our standard graph. Price on the vertical axis, Quantity on the horizontal axis."
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "write",
        "markdown": "* **Market Forces**\n* Demand: Value to consumers\n* Marginal Cost (MC): Cost to producers",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "Consumers want low prices, represented by the downward-sloping Demand curve. Producers have costs that rise as they make more, shown by the Marginal Cost curve."
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 80,
        "x2": 80,
        "y2": 20,
        "stroke": "#0074D9",
        "label": "Demand",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 20,
        "x2": 80,
        "y2": 80,
        "stroke": "#FF4136",
        "label": "MC",
        "coords": "cartesian"
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "write",
        "markdown": "* **Social Optimum**\n* : Competitive Quantity\n* Total Surplus is maximized",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "In a competitive market, equilibrium happens where these two lines cross. This point maximizes the total value for everyone. We call this the Competitive Quantity, or Q-C."
      },
      {
        "type": "draw",
        "cmd": "circle",
        "cx": 50,
        "cy": 50,
        "r": 5,
        "fill": "#333",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "text",
        "text": "Qc",
        "x": 50,
        "y": 5,
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 50,
        "y1": 50,
        "x2": 50,
        "y2": 10,
        "stroke": "#aaa",
        "stroke-dasharray": "5,5",
        "coords": "cartesian"
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "new_page",
        "title": "The Monopoly Twist"
      },
      {
        "type": "write",
        "markdown": "## Enter the Monopolist\n\n* **Market Power**\n* Has control over price",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "Now, let's clear the board and bring in a Monopoly. A monopoly is the only seller, so they don't have to accept the market price. They want to maximize their *own* profit, not society's value."
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 10,
        "y1": 10,
        "x2": 10,
        "y2": 90,
        "stroke": "#333",
        "label": "Price",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 10,
        "y1": 10,
        "x2": 90,
        "y2": 10,
        "stroke": "#333",
        "label": "Quantity",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 80,
        "x2": 80,
        "y2": 20,
        "stroke": "#0074D9",
        "label": "Demand",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 20,
        "x2": 80,
        "y2": 80,
        "stroke": "#FF4136",
        "label": "MC",
        "coords": "cartesian"
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "write",
        "markdown": "* **Marginal Revenue (MR)**\n* New curve needed\n* Falls faster than Demand",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "To find the most profitable quantity, the monopolist looks at \"Marginal Revenue.\" This curve sits below Demand because to sell one more unit, they have to lower the price for *all* units."
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 80,
        "x2": 50,
        "y2": 20,
        "stroke": "#2ECC40",
        "label": "MR",
        "coords": "cartesian"
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "write",
        "markdown": "* **The Profit Calculation**\n* Step 1: Find where \n* Step 2: Set Quantity ()",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "The monopolist produces only up to the point where their extra revenue equals their extra cost. Look at where the green line crosses the red line."
      },
      {
        "type": "draw",
        "cmd": "circle",
        "cx": 40,
        "cy": 40,
        "r": 5,
        "fill": "#333",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 40,
        "y1": 40,
        "x2": 40,
        "y2": 10,
        "stroke": "#333",
        "stroke-dasharray": "5,5",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "text",
        "text": "Qm",
        "x": 40,
        "y": 5,
        "coords": "cartesian"
      },
      {
        "type": "speak",
        "text": "This gives us the Monopoly Quantity, Q-M. Notice that it is *less* than the competitive quantity we saw before."
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "write",
        "markdown": "* **Setting the Price**\n* Go up to Demand curve\n* Price () is higher",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "Now, they don't charge that intersection price. They look at the Demand curve to see what people are willing to pay for that quantity. They hike the price up here."
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 40,
        "y1": 40,
        "x2": 40,
        "y2": 60,
        "stroke": "#333",
        "stroke-dasharray": "5,5",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "circle",
        "cx": 40,
        "cy": 60,
        "r": 5,
        "fill": "#333",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 40,
        "y1": 60,
        "x2": 10,
        "y2": 60,
        "stroke": "#333",
        "stroke-dasharray": "5,5",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "text",
        "text": "Pm",
        "x": 5,
        "y": 60,
        "coords": "cartesian"
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "new_page",
        "title": "Visualizing the Loss"
      },
      {
        "type": "write",
        "markdown": "## Deadweight Loss\n\n* **The Cost to Society**\n* Lost trades that should have happened",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "So, the monopoly raises prices and lowers quantity. But where is the specific \"Deadweight Loss\"? Let's bring back our lines to find it."
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 10,
        "y1": 10,
        "x2": 10,
        "y2": 90,
        "stroke": "#333",
        "label": "P",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 10,
        "y1": 10,
        "x2": 90,
        "y2": 10,
        "stroke": "#333",
        "label": "Q",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 80,
        "x2": 80,
        "y2": 20,
        "stroke": "#0074D9",
        "label": "D",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 20,
        "x2": 80,
        "y2": 80,
        "stroke": "#FF4136",
        "label": "MC",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 20,
        "y1": 80,
        "x2": 50,
        "y2": 20,
        "stroke": "#2ECC40",
        "label": "MR",
        "coords": "cartesian"
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "write",
        "markdown": "* **Comparing Quantities**\n* Gap between  and",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "Here is the Monopoly quantity () again, and here is where the Competitive quantity () would have been."
      },
      {
        "type": "draw",
        "cmd": "line",
        "x1": 40,
        "y1": 10,
        "x2": 40,
        "y2": 60,
        "stroke": "#333",
        "stroke-dasharray": "5,5",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "text",
        "text": "Qm",
        "x": 40,
        "y": 5,
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "text",
        "text": "Qc",
        "x": 50,
        "y": 5,
        "coords": "cartesian"
      },
      {
        "type": "speak",
        "text": "The gap between these two quantities represents products that *could* have been sold. Customers wanted them (Demand > Cost), but the monopoly refused to produce them to keep prices high."
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "write",
        "markdown": "* **The Deadweight Triangle**\n* Area of lost value\n* Neither Consumer nor Producer gets this",
        "location": "left"
      },
      {
        "type": "speak",
        "text": "This creates a triangle of lost value. The area between the Demand curve and the Marginal Cost curve, for those missing units. This is the Deadweight Loss."
      },
      {
        "type": "draw",
        "cmd": "polygon",
        "points": [
          [
            40,
            60
          ],
          [
            40,
            40
          ],
          [
            50,
            50
          ]
        ],
        "fill": "rgba(255, 0, 0, 0.4)",
        "coords": "cartesian"
      },
      {
        "type": "draw",
        "cmd": "text",
        "text": "DWL",
        "x": 45,
        "y": 50,
        "coords": "cartesian"
      },
      {
        "type": "speak",
        "text": "This red area represents pure waste. It is wealth that was destroyed because the market was restricted."
      },
      {
        "type": "wait",
        "click": true
      },
      {
        "type": "question",
        "markdown": "Which statement best describes the cause of Deadweight Loss in a monopoly?",
        "choices": [
          "The monopolist produces less than the socially optimal quantity ().",
          "The monopolist charges a price equal to Marginal Cost.",
          "The monopolist produces more than the market demands.",
          "The Marginal Revenue curve is above the Demand curve."
        ],
        "correct_indices": [
          0
        ]
      }
];