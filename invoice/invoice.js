module.exports = ({
  orderId,
  totalPrice,
  expectedHubArrivalDate,
  packages,
  DestinationDetail,
  SupplierDetail,
  ConsigneeDetail
}) => {
 
  const today = new Date(expectedHubArrivalDate);
  return (
    `<head>      
        <title>Document</title>
    </head>

    <style>
    #customers {
        font-family: Arial, Helvetica, sans-serif;
        border-collapse: collapse;
        width: 100%;
      }
      
      #customers td, #customers th {
        border: 1px solid #ddd;
        padding: 8px;
      }
      #customers th {
        padding-top: 12px;
        padding-bottom: 12px;
        text-align: left;
        background-color: #04AA6D;
        color: white;
      }
    </style>
    <body>
        <h1>Invoice : #${orderId} </h1>
        <h4>Order Id : ${orderId}</h4>
        <h4>Total Price : ${totalPrice}</h4>
        <h4>Expected Hub Arrival Date : ${today.getFullYear()}-${today.getMonth()}-${today.getDate()}</h4>
        <div>
        
        <table id="customers">
        <h4>Packages Details</h4>
        <thead>
        <tr>
        <th>Type</th>
        <th>Length(cm)</th>
        <th>Weight(kg)</th>
        <th>Height(cm)</th>
        <th>Width(cm)</th>
        </tr>
        </thead>
        
       
        ` +
    packages.map(
      (package) =>
      (
        `<tbody > <tr>
        <td>Capture</td>
      <td>${package.captureLength}</td>
      <td>${package.captureWeight}</td>
      <td>${package.captureHeight}</td>
      <td>${package.captureWidth}</td>
      </tr>
      <tr>
        <td>Measured</td>
      <td>${package.measuredLength}</td>
      <td>${package.measuredWeight}</td>
      <td>${package.measuredHeight}</td>
      <td>${package.measuredWidth}</td>
      </tr></tbody>
      `)
    ) +
    `</table></div>` +
    `
    <table id="customers">
    <h4>Destination Detail</h4>
    <thead>
    <tr>
    <th>Company</th>
    <th>Address</th>
    <th>Country</th>
    <th>Email</th>
    <th>Phone</th>
    </tr>
    </thead>
    <tbody>
    
    <tr>
    <td>${DestinationDetail.companyName}</td>
    <td>${DestinationDetail.address}</td>
    <td>${DestinationDetail.country}</td>
    <td>${DestinationDetail.email}</td>
    <td>${DestinationDetail.phone}</td>   
    </tr></tbody>
    </table>
    
    <table id="customers">
    <h4>Supplier Detail</h4>
    <tbody>
    <tr>
    <th>Contact Name</th>
    <th>Email</th>
    <th>Phone</th>
    <th>Tracking No</th>
    <th>Tracking Link</th>
    </tr>
    <tr>
    <td>${SupplierDetail.contactName}</td>
    <td>${SupplierDetail.email}</td>
    <td>${SupplierDetail.phone}</td>
    <td>${SupplierDetail.trackingNo}</td>
    <td>${SupplierDetail.trackingLink}</td>   
    </tr></tbody>
   
    
    <table id="customers">
    <h4>Consignee Detail</h4>
    <tbody>
    <tr>
    <th>Contact Name</th>
    <th>Email</th>
    <th>Phone</th>
    <th>Tracking No</th>
    <th>Tracking Link</th>
    </tr>
    <tr>
    <td>${ConsigneeDetail.companyName}</td>
    <td>${ConsigneeDetail.address}</td>
    <td>${ConsigneeDetail.country}</td>
    <td>${ConsigneeDetail.email}</td>
    <td>${ConsigneeDetail.phone}</td>  
    </tr></tbody>
   
    <table id="customers">
    <h4>Send Package to Below Address</h4>
    <tbody>
    <tr>
    <th>Company</th>
    <th>Address</th>
    <th>Country</th>
    <th>Email</th>
    <th>Phone</th>
    </tr>
    <tr>
    <td>${DestinationDetail.companyName}</td>
    <td>${DestinationDetail.address}</td>
    <td>${DestinationDetail.country}</td>
    <td>${DestinationDetail.email}</td>
    <td>${DestinationDetail.phone}</td>   
    </tr></tbody>
    
    </div>
    
    
    </body>
    </html>`
  );
};
