#!/bin/bash
# Simple HSN check using curl to your API endpoints

echo "=== HSN Code Check (via API) ==="

# Check if backend is running
if ! curl -s http://localhost:3000/api/products >/dev/null; then
    echo "❌ Backend not running or not accessible on localhost:3000"
    exit 1
fi

echo "✅ Backend is running"
echo ""

# Get products data
echo "📋 Fetching active products..."
PRODUCTS=$(curl -s "http://localhost:3000/api/products?active=true" | head -c 2000)

if [[ $PRODUCTS == *"name"* ]]; then
    echo "✅ Products found"
    
    # Count products with and without HSN codes
    TOTAL_PRODUCTS=$(echo "$PRODUCTS" | grep -o '"name"' | wc -l)
    WITH_HSN=$(echo "$PRODUCTS" | grep -o '"hsn_sac_code":"[^"]\+[^"]"' | wc -l)
    WITHOUT_HSN=$((TOTAL_PRODUCTS - WITH_HSN))
    
    echo ""
    echo "📊 Summary:"
    echo "Total active products: $TOTAL_PRODUCTS"
    echo "Products with HSN codes: $WITH_HSN"
    echo "Products missing HSN: $WITHOUT_HSN"
    
    if [ $WITH_HSN -eq 0 ]; then
        echo ""
        echo "⚠️  NO HSN CODES FOUND! This is why HSN column is empty."
        echo ""
        echo "🔧 Sample products from your database:"
        echo "$PRODUCTS" | grep -o '"name":"[^"]*"' | head -5
        echo ""
        echo "💡 You need to add HSN codes to your products."
        echo "   Go to your admin panel → Products → Edit each product → Add HSN code"
        echo "   Or you can manually update the database."
    else
        echo ""
        echo "✅ Some products have HSN codes. Check if your specific products have them."
        echo "   Sample products with HSN:"
        echo "$PRODUCTS" | grep -A1 -B1 '"hsn_sac_code":"[^"]\+[^"]"' | head -10
    fi
    
else
    echo "❌ Could not fetch products. Response:"
    echo "$PRODUCTS"
fi